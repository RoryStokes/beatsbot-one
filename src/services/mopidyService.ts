import * as Mopidy from "mopidy";
import { countBy, groupBy } from "lodash";
import { MessageEmbedOptions } from "discord.js";

export type TrackRef = {
  name: string;
  uri: string;
};
export type Track = Mopidy.models.Track

export type MaybeSong = Mopidy.models.Track & {
  derived?: {
    artistString: string;
    songName: string;
    songString: string;
    durationString: string;
  }
};

export type Song = Mopidy.models.Track & {
  derived: {
    artistString: string;
    songName: string;
    songString: string;
    durationString: string;
  };
};

export class MopidyService {
  private client: Mopidy;
  public playing: boolean;
  public currentSong?: Song;
  public currentTracklist?: string[] = [];
  private onPlayHandler;
  private onStopHandler;
  private prePlayHandler;
  private onQueueHandler: (track: Track) => Promise<void>;

  constructor(config) {
    this.client = new Mopidy({
      webSocketUrl: config.mopidyWsUrl,
    });

    this.playing = false;

    this.client.on("state:online", async () =>{
      await this.checkPlaying();
      this.currentTracklist = ((await this.client.tracklist?.getTracks()) || []).map(t => t.uri);
    });

    this.client.on(
      "event:trackPlaybackStarted",
      async function (event) {
        this.nowPlaying(event.tl_track.track);
      }.bind(this)
    );

    this.client.on(
      "event:playbackStateChanged",
      async (event) => {
        if (event.new_state === "stopped") {
          this.stopped();
        }
      }
    );

    this.client.on("event:tracklistChanged", async () => {
      const index = await this.client.tracklist.index({});

      const currentTracklist = this.currentTracklist.slice() || [];
      const currentCounts = countBy(currentTracklist.slice(index + 1));
      console.log(index);

      const newTracklist = await this.client.tracklist?.getTracks() || [];
      const newTracks = groupBy(newTracklist.slice(index + 1), "uri")
      
      const added = Object.keys(newTracks).flatMap(uri => newTracks[uri].slice(currentCounts[uri] || 0));

      this.currentTracklist = newTracklist.map(t => t.uri);

      if(this.onQueueHandler) {
        added.forEach(this.onQueueHandler)
      }
    });
  }

  async checkPlaying() {
    this.playing = (await this.client.playback.getState()) === "playing";
    if (this.playing) {
      const song = await this.client.playback.getCurrentTrack();
      this.nowPlaying(song);
    }
  }

  disconnect() {
    this.client.close();
    this.client.off();
    this.client = null;
  }

  deriveSongFields(song: MaybeSong): Song {
    if(song.derived !== undefined) {
      return song as Song;
    }

    let artistString = song.artists
      ? song.artists.map((a) => a.name).join(", ")
      : "Unknown Artist";
    let songName = song.name;
    if (!songName) {
      const match = song.uri.match(/[:/]([^:/]+)\.\w+$/);
      if (match) {
        const fileName = decodeURIComponent(match[1]);
        const parts = fileName.split(" - ");
        if (parts.length >= 4) {
          songName = parts[3];
          artistString = parts[1];
        } else if (parts.length > 1) {
          const probablyName = parts[parts.length - 2];
          const probablyArtist = parts[parts.length - 1];

          if (
            probablyArtist.includes("(") ||
            probablyName.match(/ f(ea)?t\.? /)
          ) {
            songName = probablyArtist;
            artistString = probablyName;
          } else {
            songName = probablyName;
            artistString = probablyArtist;
          }
        } else {
          songName = parts[0];
        }
      }
    }

    songName = songName || "Untitled";

    const songString = `${songName} - ${artistString}`;

    const durationString = `🕙 ${Math.floor(song.length / 60000)}:${String(
      Math.round(song.length / 1000) % 60
    ).padStart(2, "0")}`;

    const derived = { artistString, songName, songString, durationString };

    return { ...song, derived };
  }

  async getSong(uri, points) {
    const result = await this.client.library.lookup({ uris: [uri] });
    const song = Object.assign({ points }, result[0][0]);
    return this.deriveSongFields(song);
  }

  async getRecent(maxResults = 5) {
    const history = (await this.client.history.getHistory()) as any;
    console.log(JSON.stringify(history, null, 2));
    return history
      .slice(0, maxResults)
      .map(([timestamp, song]) => this.deriveSongFields(song));
  }

  async getImage(song: Song) {
    const imageMap = await this.client.library.getImages({ uris: [song.uri] });
    return imageMap[song.uri][0] ? imageMap[song.uri][0].uri : null;
  }

  async getQueue() {
    const tracks = await this.client.tracklist.getTracks();
    const index = await this.client.tracklist.index({});
    return { tracks, index };
  }

  async next() {
    if (this.client.tracklist.getEotTlid()) {
      await this.client.playback.next();
      return true;
    } else {
      await this.client.playback.stop();
    }
  }

  async playTracks(tracks: TrackRef[], playNow: boolean) {
    if (playNow || (await this.client.playback.getState()) !== "playing") {
      await this.client.tracklist.clear();
      await this.client.tracklist.add({ uris: tracks.map(t => t.uri) });
      await this.client.playback.play({});
      return true;
    } else {
      await this.client.tracklist.add({ uris: tracks.map(t => t.uri) });
      return false;
    }
  }

  async playUri(uri: string, playNow: boolean) {
    if (playNow || (await this.client.playback.getState()) !== "playing") {
      await this.client.tracklist.clear();
      await this.client.tracklist.add({ uris: [uri] });
      await this.client.playback.play({});
      return true;
    } else {
      await this.client.tracklist.add({ uris: [uri] });
      return false;
    }
  }

  nowPlaying(song) {
    this.playing = true;
    this.currentSong = this.deriveSongFields(song);

    if (this.onPlayHandler) {
      this.onPlayHandler(this.currentSong);
    }
  }

  stopped() {
    this.playing = false;

    if (this.onStopHandler) {
      this.onStopHandler(this.currentSong);
    }

    this.currentSong = null;
  }

  prePlay(handler) {
    this.prePlayHandler = handler;
  }

  onPlay(handler) {
    this.onPlayHandler = handler;
  }

  onStop(handler) {
    this.onStopHandler = handler;
  }

  onQueue(handler: (track: Track) => Promise<void>) {
    this.onQueueHandler = handler;
  }

  stop() {
    this.client.tracklist.setRepeat({ value: false });
    this.client.tracklist.setSingle({ value: false });
    return this.client.playback.stop();
  }

  repeat(single) {
    this.client.tracklist.setRepeat({ value: true });
    this.client.tracklist.setSingle({ value: single });
  }

  async playlistQuery(queries: string[]): Promise<TrackRef[]> {
    if (this.client.playlists && this.client.library) {
      const allPlaylists = await this.client.playlists.asList();
      const filteredPlaylistRefs = allPlaylists.filter((p) =>
        queries.some((q) => p.name.toLowerCase().startsWith(q))
      );
      const playlists = await Promise.all(
        filteredPlaylistRefs.map((p) =>
          this.client.playlists.lookup({ uri: p.uri })
        )
      );
      const playlistTracks = playlists.flatMap((p) => p.tracks);

      const localTracks = await this.getLocalTracksMatchingQuery(
        "file:///home/rory/Dropbox/Chatsongs",
        queries,
        this.client.library
      );

      console.log(playlistTracks);
      console.log(localTracks);

      return [...playlistTracks, ...localTracks];
    }
  }

  async getLocalTracksMatchingQuery(
    uri: string,
    queries: string[],
    library: Mopidy.core.LibraryController
  ): Promise<TrackRef[]> {
    return this.flattenPromises(
      (await library.browse({ uri })).flatMap(async (ref) => {
        if (ref.type == "directory") {
          if (queries.some((q) => ref.name.toLowerCase().startsWith(q))) {
            return await this.getAllChildTracks(ref, library);
          }
          this.getLocalTracksMatchingQuery(ref.uri, queries, library);
        }
        return [];
      })
    );
  }

  async getAllChildTracks(
    directory: Mopidy.models.Ref<"directory">,
    library: Mopidy.core.LibraryController
  ): Promise<TrackRef[]> {
    return this.flattenPromises(
      (await library.browse({ uri: directory.uri })).flatMap(
        async (ref: Mopidy.models.Ref<Mopidy.models.ModelType>) => {
          if (this.refIsType(ref, "directory")) {
            return await this.getAllChildTracks(ref, library);
          } else if (this.refIsType(ref, "track")) {
            return [ref];
          }
          return [];
        }
      )
    );
  }

  private refIsType<A extends Mopidy.models.ModelType>(
    ref: Mopidy.models.Ref<any>,
    type: A
  ): ref is Mopidy.models.Ref<A> {
    return ref.type == type;
  }

  private flattenPromises<A>(promises: Promise<A[]>[]): Promise<A[]> {
    return Promise.all(promises).then((n) => n.flatMap((a) => a));
  }
  async search(query, source) {
    const uris = source ? [`${source}:`] : null;
    const result = await this.client.library.search({
      query: { any: query.split(" ") },
      uris,
    });
    return result[0];
  }
  
  async beatEmbeds(beat: Song | Track) {
    const song = this.deriveSongFields(beat);
    const image = await this.getImage(song);
  
    const iconURL = image && image.startsWith("http") ? image : undefined;
  
    const thumbnail = iconURL ? { url: iconURL } : undefined;
  
    const nowPlaying: MessageEmbedOptions = {
      title: "Now Playing",
      url: "https://beatsbot.one/iris/queue",
      fields: [
        {
          name: song.derived.songName,
          value: song.derived.artistString,
        },
        {
          name: "Duration",
          value: song.derived.durationString,
          inline: true,
        },
      ],
      color: "#08d58f",
      thumbnail,
    };
  
    const action = (action?: string): MessageEmbedOptions => ({
      footer: {
        iconURL,
        text: action ? `${action} ${song.derived.songString}` : song.derived.songString,
      },
      color: "#08d58f",
    });
  
    const simple: MessageEmbedOptions = {
      title: song.derived.songName,
      description: song.derived.artistString,
      url: `https://beatsbot.one/play?uri=${encodeURIComponent(song.uri)}`,
      fields: [
        {
          name: "Duration",
          value: song.derived.durationString,
          inline: true,
        },
      ],
      color: "#08d58f",
      thumbnail,
    };
  
    return { nowPlaying, action, simple };
  };
}

export default MopidyService;
