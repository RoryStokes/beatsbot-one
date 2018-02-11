const PulseAudio = require('pulseaudio-client')
const Mopidy = require('mopidy')

class MopidyService {
  constructor (config) {
    this.client = new Mopidy({webSocketUrl: config.mopidyWsUrl, callingConvention: 'by-position-only'})
    this.pulseContext = PulseAudio()
    this.playing = false

    this.client.on('state:online', this.checkPlaying.bind(this))

    this.client.on('event:trackPlaybackStarted', async function (event) {
      this.nowPlaying(event.tl_track.track)
    }.bind(this))

    this.client.on('event:playbackStateChanged', async function (event) {
      if (event.new_state === 'stopped') {
        this.stopped()
      }
    }.bind(this))
  }

  async checkPlaying () {
    this.playing = (await this.client.playback.getState() === 'playing')
    if (this.playing) {
      const song = await this.client.playback.getCurrentTrack()
      this.nowPlaying(song)
    }
  }

  disconnect () {
    this.client.close()
    this.client.off()
    this.client = null
  }

  deriveSongFields (song) {
    let artistString = song.artists ? song.artists.map(a => a.name).join(', ') : 'Unknown Artist'
    let songName = song.name
    if (!songName) {
      const match = song.uri.match(/[:/]([^:/]+)\.\w+$/)
      if (match) {
        const fileName = decodeURIComponent(match[1])
        const parts = fileName.split(' - ')
        if (parts.length >= 4) {
          songName = parts[3]
          artistString = parts[1]
        } else if (parts.length > 1) {
          const probablyName = parts[parts.length - 2]
          const probablyArtist = parts[parts.length - 1]

          if (probablyArtist.includes('(') || probablyName.match(/ f(ea)?t\.? /)) {
            songName = probablyArtist
            artistString = probablyName
          } else {
            songName = probablyName
            artistString = probablyArtist
          }
        } else {
          songName = parts[0]
        }
      }
    }

    songName = songName || 'Untitled'

    const songString = `${songName} - ${artistString}`

    const durationString = `🕙 ${Math.floor(song.length / 60000)}:${String(Math.round(song.length / 1000) % 60).padStart(2, '0')}`

    const derived = { artistString, songName, songString, durationString }

    return Object.assign({derived}, song)
  }

  async getSong (uri, points) {
    const result = await this.client.library.lookup(uri)
    const song = Object.assign({points}, result[0])
    return this.deriveSongFields(song)
  }

  async getRecent (maxResults = 5) {
    const history = await this.client.history.getHistory()
    return history.slice(0, maxResults).map(([timestamp, song]) => this.deriveSongFields(song))
  }

  async getImage (song) {
    const imageMap = await this.client.library.getImages([song.uri])
    return imageMap[song.uri][0] ? imageMap[song.uri][0].uri : null
  }

  async getQueue () {
    const tracks = await this.client.tracklist.getTracks()
    const index = await this.client.tracklist.index()
    return { tracks, index }
  }

  async next () {
    if (this.client.tracklist.getEotTlid()) {
      await this.client.playback.next()
      return true
    } else {
      await this.client.playback.stop()
    }
  }

  async playSong (songUris, playNow) {
    if (playNow || await this.client.playback.getState() !== 'playing') {
      await this.client.tracklist.clear()
      await this.client.tracklist.add(null, null, null, songUris)
      await this.client.playback.play()
      return true
    } else {
      await this.client.tracklist.add(null, null, null, songUris)
      return false
    }
  }

  nowPlaying (song) {
    this.playing = true
    this.currentSong = this.deriveSongFields(song)

    if (!this.audioStream) {
      this.audioStream = this.pulseContext.record({
        rate: 48000,
        channels: 2
      })
    }

    if (this.onPlay) {
      this.onPlay(this.currentSong, this.audioStream)
    }
  }

  stopped () {
    this.playing = false

    if (this.audioStream) {
      this.audioStream.stop()
      this.audioStream = null
    }

    if (this.onStop) {
      this.onStop(this.currentSong)
    }

    this.currentSong = null
  }

  onPlay (handler) {
    this.onPlay = handler
  }

  onStop (handler) {
    this.onStop = handler
  }

  stop () {
    this.client.tracklist.setRepeat(false)
    this.client.tracklist.setSingle(false)
    return this.client.playback.stop()
  }

  repeat (single) {
    this.client.tracklist.setRepeat(true)
    this.client.tracklist.setSingle(single)
  }

  async search (query, source) {
    const uris = source ? [`${source}:`] : null
    const result = await this.client.library.search({any: query.split(' ')}, uris)
    return result[0]
  }
}

module.exports = MopidyService
