import AsciiTable from "ascii-table";
import { handleMessage } from "./custom";

const config = {
  spotifyAppId: process.env.SPOTIFY_APP_ID,
  spotifyAppSecret: process.env.SPOTIFY_APP_SECRET,
  spotifyUsername: process.env.SPOTIFY_USERNAME,
  spotifyPassword: process.env.SPOTIFY_PASSWORD,
  externalUrl: process.env.EXTERNAL_URL,
  spotifyUserId: process.env.SPOTIFY_USER_ID,
  spotifyTopPlaylistId: process.env.SPOTIFY_TOP_PLAYLIST_ID,
  discordSecret: process.env.DISCORD_SECRET,
  beatsPointsLocation:
    process.env.BEATS_POINTS_LOCATION || "/var/lib/data/beatspoints",
  mopidyWsUrl: process.env.MOPIDY_WS_URL || "ws://mopidy:6680/mopidy/ws/",
  idleTimeoutSeconds: process.env.IDLE_TIMEOUT_SECONDS || 60,
  voteTimeoutSeconds: process.env.VOTE_TIMEOUT_SECONDS || 60,
  maxTransmissionGap: parseInt(process.env.MAX_TRANSMISSION_GAP || "") || 500000,
  audioDevice: process.env.AUDIO_DEVICE,
};

import DiscordService from "./services/discordService";
import MopidyService, { Song } from "./services/mopidyService";

import AudioService from "./services/audioService";
import { Message, MessageEmbedOptions, PartialTextBasedChannelFields, StageChannel, TextBasedChannelFields, TextChannel, VoiceChannel } from "discord.js";

const discordService = new DiscordService(config);
const mopidyService = new MopidyService(config);
const audioService = new AudioService(config);

const maxMessageLength = 2000;
const maxBeats = 100;
const maxResults = 10;

mopidyService.onPlay(async function (song, stream) {
  // await discordService.streamAudio(stream, song.derived.songString);

  // Configure new song
  const embed = await songEmbed(mopidyService.deriveSongFields(song));
  const currentSongEmbed = await discordService.postEmbed(embed);
});

mopidyService.onStop(async function (song) {
  discordService.stopAudio();
  await stop();
});

const songEmbed = async function (song: Song): Promise<MessageEmbedOptions> {
  const image = await mopidyService.getImage(song);

  return {
    title: "Now Playing",
    url: config.externalUrl,
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
    thumbnail: image,
  };
};

const stop = async function () {
  mopidyService.stop();
};

// const normaliseSpotifyPlaylists = async function (song) {
//   if (false) {// temporarily disabled because of broken spotify auth song.uri.startsWith('spotify')) {
//     // We want to handle spotify playlists with non-numeric user ids manually
//     const [,, userId, maybePlaylist, playlistId] = song.uri.split(':')
//     if (maybePlaylist === 'playlist' && parseInt(userId) !== userId) {
//       const playlist = await spotifyService.getPlaylist(userId, playlistId).catch(e => console.log(e))
//       return playlist.body.tracks.items.map(data => data.track.uri)
//     }
//   }

//   return [song.uri]
// }

const playSong = async function (message, song, playNow) {
  if (!(await joinChannel(message))) {
    return;
  }

  // const normalised = await normaliseSpotifyPlaylists(song)
  const playingNow = await mopidyService.playSong(song, playNow);

  if (!playingNow) {
    await message.channel.send(
      `Queued ${
        mopidyService.deriveSongFields(song).derived.songName ||
        song.uri.split(":")[1]
      }`
    );
  }
};

const songChoice = async function (message, response, songs, playNow, n?) {
  if (songs.length === 0) {
    response.edit("No results found.");
    return;
  }

  if (n && n < songs.length) {
    playSong(message, songs[n], playNow);
  }

  const songsWithPoints = await Promise.all(
    songs.slice(0, maxResults).map(mopidyService.deriveSongFields)
  );

  await response.delete();

  let choiceMessage = await message.channel.send(
    beatsTable("Choose a song:", songsWithPoints)[0]
  );
  discordService.chooseNumber(
    choiceMessage,
    songsWithPoints.length,
    (number) => {
      return playSong(message, songs[number], playNow);
    }
  );
};

const youtubeUrlRegex = new RegExp(
  "(https?:\\/\\/)?(www.)?youtu(\\.be|be\\.com).*"
);

const searchPriorities = ["local", "spotify"];

const play = async function (message, query, playNow, number) {
  console.log(number);
  if (isJoinable(message.member.voice.channel, message.channel)) {
    if (youtubeUrlRegex.test(query)) {
      return playSong(message, { uri: `yt:${query}` }, playNow);
    } else if (query.startsWith("spotify:")) {
      return playSong(message, { uri: query }, playNow);
    } else if (query.startsWith("https://open.spotify.com")) {
      return playSong(
        message,
        { uri: `spotify${query.substring(24).split("/").join(":")}` },
        playNow
      );
    } else {
      const response = await message.channel.send("Searching...");

      let tracks = [];
      const queryArgs = query.split(" ");

      for (const songSource of searchPriorities) {
        const sourceResults = await mopidyService.search(query, songSource);

        if (
          sourceResults &&
          sourceResults.tracks &&
          sourceResults.tracks.length > 0
        ) {
          if (sourceResults.tracks.length === 1) {
            response.delete();
            return playSong(message, sourceResults.tracks[0], playNow);
          } else {
            tracks = [...tracks, ...sourceResults.tracks];
          }

          if (tracks.length >= maxResults) break;
        }
      }

      return songChoice(message, response, tracks, playNow, number);
    }
  }
};

const rand = async function (message, query, playNow) {
  if (isJoinable(message.member.voice.channel, message.channel)) {
    const response = await message.channel.send("Searching...");

    for (const songSource of searchPriorities) {
      const sourceResults = await mopidyService.search(query, songSource);
      if (sourceResults.tracks && sourceResults.tracks.length) {
        response.delete();
        const idx = Math.floor(Math.random() * sourceResults.tracks.length);
        return playSong(message, sourceResults.tracks[idx], playNow);
      }
    }

    response.edit("No results found.");
  }
};

const isJoinable = function (channel: VoiceChannel | StageChannel, textChannel: PartialTextBasedChannelFields): channel is VoiceChannel {
  if (channel && channel.type == 'voice') {
    return true;
  } else {
    textChannel.send("You need to join a voice channel first!");
    return false;
  }
};

const joinChannel = async function (message: Message) {
  const channel = message.member.voice.channel;
  console.log(channel);
  if (isJoinable(channel, message.channel)) {
    await discordService.startAudio(channel, audioService.getPlayer());
    return true;
  }
  return false;
};

const kill = async function (message) {
  await message.channel.send("Goodbye, cruel world.");
  await discordService.disconnect();
  mopidyService.disconnect();
  process.exit();
};

const ellipse = function (str, max) {
  return str.length > max - 3 ? str.substring(0, max - 3) + "..." : str;
};

const beatsTable = function (title, beats, params?) {
  const { index, first } = params || {};

  if (beats.length === 0) {
    return ["No results."];
  }
  const table = new AsciiTable().setHeading("#", "Name", "Artist(s)", "Score");

  beats.forEach((song, i) => {
    const num = i + 1 + (first || 0);
    table.addRow(
      index === i ? `> ${num}` : num,
      ellipse(song.derived.songName, 60),
      ellipse(song.derived.artistString, 40),
      song.points
    );
  });
  const tableLines = table.toString().split("\n");

  let message = `**${title}**\n`;

  if (first) {
    message += `*Showing results from ${first + 1} to ${
      first + beats.length
    }.*`;
  }

  message += "```";
  const messages = [];

  for (const line of tableLines) {
    if (message.length + line.length > maxMessageLength - 6) {
      messages.push(message + "```");
      message = "```" + line;
    } else {
      message += "\n" + line;
    }
  }

  return [...messages, message + "```"];
};

const queue = async function (message) {
  const { tracks, index } = await mopidyService.getQueue();
  const songs = await Promise.all(tracks.map(mopidyService.deriveSongFields));
  const messages = beatsTable("Queued Tracks", songs, { current: index });

  for (const body of messages) {
    await message.channel.send(body);
  }
};

const skip = async function (message) {
  if (!(await mopidyService.next())) {
    message.channel.send("Out of beats!");
  }
};

const recent = async function (message, args, playNow) {
  if (isJoinable(message.member.voice.channel, message.channel)) {
    const response = await message.channel.send("Fetching history...");
    const songs = await mopidyService.getRecent();
    songChoice(message, response, songs, playNow);
  }
};

const repeat = async function (message, args, thisSong) {
  if (mopidyService.playing) {
    mopidyService.repeat(thisSong);
  } else {
    message.channel.send("Not currently playing anything.");
  }
};

const commands = {
  stop: {
    action: stop,
    description: "Stop any currently playing song and clear the playlist.",
  },
  join: {
    action: joinChannel,
    description: "Request the bot join your current voice channel.",
  },
  rand: {
    action: rand,
    description: "Select a random song that matches the search query.",
    args: ["query"],
    bang: "Plays immediately rather than adding to the queue.",
  },
  skip: {
    action: skip,
    description: "Skip the currently playing song.",
  },
  play: {
    action: play,
    description:
      "If a unique song matches the query, play it. Otherwise choose out of the top 5 results.",
    args: ["query"],
    bang: "Plays immediately rather than adding to the queue.",
  },
  recent: {
    action: recent,
    description:
      "List the most recent 5 songs played. You may select one to play.",
  },
  repeat: {
    action: repeat,
    description: "Play the current tracklist on repeat.",
    bang: "Play only the current song on repeat.",
  },
  queue: {
    action: queue,
    description: "List the currently queued tracks.",
  },
  kill: {
    action: kill,
    description: "Terminate the bot. Pray he returns.",
  },
};

discordService.onMessage(commands, async (message, cmd, args, bang) => {
  const action = handleMessage(cmd, args);

  if (action) {
    console.log(action);
    if (action.reply) message.channel.send(action.reply);
    if (action.play) playSong(message, { uri: action.play }, action.bang);
    return true;
  }
});

discordService.startBot();
