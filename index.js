const AsciiTable = require('ascii-table')
const custom = require('./custom')

const config = {
  spotifyAppId: process.env.SPOTIFY_APP_ID,
  spotifyAppSecret: process.env.SPOTIFY_APP_SECRET,
  spotifyUsername: process.env.SPOTIFY_USERNAME,
  spotifyPassword: process.env.SPOTIFY_PASSWORD,
  externalUrl: process.env.EXTERNAL_URL,
  spotifyUserId: process.env.SPOTIFY_USER_ID,
  spotifyTopPlaylistId: process.env.SPOTIFY_TOP_PLAYLIST_ID,
  discordSecret: process.env.DISCORD_SECRET,
  beatsPointsLocation: process.env.BEATS_POINTS_LOCATION || '/var/lib/data/beatspoints',
  mopidyWsUrl: process.env.MOPIDY_WS_URL || 'ws://mopidy:6680/mopidy/ws/',
  idleTimeoutSeconds: process.env.IDLE_TIMEOUT_SECONDS || 60
}

const SpotifyService = require('./services/spotifyService')
const DiscordService = require('./services/discordService')
const VoteService = require('./services/voteService')
const MopidyService = require('./services/mopidyService')

const spotifyService = new SpotifyService(config)
const discordService = new DiscordService(config)
const voteService = new VoteService(config)
const mopidyService = new MopidyService(config)

const maxMessageLength = 2000
const maxBeats = 100
const maxResults = 10

spotifyService.authenticateAsUser(config.spotifyUsername, config.spotifyPassword)

let currentSongEmbed

mopidyService.onPlay(async function (song, stream) {
  await discordService.streamAudio(song.derived.songString, stream)

  // Clean up currently running song
  voteService.endVote()
  discordService.clearCollectors()

  // Configure new song
  voteService.startNewVote(song.uri)
  const embed = await songEmbed(mopidyService.deriveSongFields(song))
  currentSongEmbed = await discordService.postEmbed(embed)
  discordService.collectReactionsForMessage(currentSongEmbed, vote)
})

mopidyService.onStop(async function (song) {
  discordService.stopAudio()
  await stop()
})

const songEmbed = async function (song) {
  const image = await mopidyService.getImage(song)
  const points = await voteService.getScore(song.uri)

  return discordService.embed()
    .setTitle('Now Playing', config.externalUrl)
    .addField(song.derived.songName, song.derived.artistString)
    .addField('Duration', song.derived.durationString, true)
    .addField('BeatsPoints', (points >= 0) ? `🎺 ${points}` : `⚓ ${points}`, true)
    .setColor('#08d58f')
    .setThumbnail(image)
}

const vote = async function (userId, delta) {
  voteService.vote(userId, delta)

  // Update the embed for the currently playing song
  const embed = await songEmbed(mopidyService.currentSong)
  await discordService.postEmbed(embed, currentSongEmbed)
}

const upvote = function (message) {
  if (mopidyService.playing) {
    vote(message.author.id, 1)
    discordService.collectReactionsForMessage(message, vote, 1)
  }
}

const downvote = function (message) {
  if (mopidyService.playing) {
    vote(message.author.id, -1)
    discordService.collectReactionsForMessage(message, vote, -1)
  }
}

const stop = async function () {
  mopidyService.stop()
}

const normaliseSpotifyPlaylists = async function (song) {
  if (song.uri.startsWith('spotify')) {
    // We want to handle spotify playlists with non-numeric user ids manually
    const [,, userId, maybePlaylist, playlistId] = song.uri.split(':')
    if (maybePlaylist === 'playlist' && parseInt(userId) !== userId) {
      const playlist = await spotifyService.getPlaylist(userId, playlistId).catch(e => console.log(e))
      return playlist.body.tracks.items.map(data => data.track.uri)
    }
  }

  return [song.uri]
}

const playSong = async function (message, song, playNow) {
  if (!await joinChannel(message)) {
    return
  }

  const normalised = await normaliseSpotifyPlaylists(song)
  const playingNow = await mopidyService.playSong(normalised, playNow)

  if (!playingNow) {
    await message.channel.send(`Queued ${mopidyService.deriveSongFields(song).derived.songName || song.uri.split(':')[1]}`)
  }
}

const getFullSongData = async function (song) {
  const songWithDerived = mopidyService.deriveSongFields(song)
  const points = await voteService.getScore(song.uri)
  return Object.assign({points}, songWithDerived)
}

const songChoice = async function (message, response, songs, playNow) {
  if (songs.length === 0) {
    response.edit('No results found.')
    return
  }

  const songsWithPoints = await Promise.all(
    songs.slice(0, maxResults).map(getFullSongData)
  )

  await response.delete()

  let choiceMessage = await message.channel.send(beatsTable('Choose a song:', songsWithPoints)[0])
  discordService.chooseNumber(choiceMessage, songsWithPoints.length, number => {
    return playSong(message, songs[number], playNow)
  })
}

const youtubeUrlRegex = new RegExp('(https?:\\/\\/)?(www.)?youtu(\\.be|be\\.com).*')

const searchPriorities = ['local', 'spotify', 'youtube']

const play = async function (message, query, playNow) {
  if (verifyJoinable(message)) {
    if (youtubeUrlRegex.test(query)) {
      return playSong(message, {uri: `yt:${query}`}, playNow)
    } else if (query.startsWith('spotify:')) {
      return playSong(message, {uri: query}, playNow)
    } else if (query.startsWith('https://open.spotify.com')) {
      return playSong(message, {uri: `spotify${query.substring(24).split('/').join(':')}`}, playNow)
    } else {
      const response = await message.channel.send('Searching...')

      let tracks = []

      for (const songSource of searchPriorities) {
        const sourceResults = await mopidyService.search(query, songSource)

        if (sourceResults && sourceResults.tracks && sourceResults.tracks.length > 0) {
          if (sourceResults.tracks.length === 1) {
            response.delete()
            return playSong(message, sourceResults.tracks[0], playNow)
          } else {
            tracks = [...tracks, ...sourceResults.tracks]
          }

          if (tracks.length >= maxResults) break
        }
      }

      return songChoice(message, response, tracks, playNow)
    }
  }
}

const rand = async function (message, query, playNow) {
  if (verifyJoinable(message)) {
    const response = await message.channel.send('Searching...')

    for (const songSource of searchPriorities) {
      const sourceResults = await mopidyService.search(query, songSource)
      if (sourceResults.tracks && sourceResults.tracks.length) {
        response.delete()
        const idx = Math.floor(Math.random() * sourceResults.tracks.length)
        return playSong(message, sourceResults.tracks[idx], playNow)
      }
    }

    response.edit('No results found.')
  }
}

const verifyJoinable = function (message) {
  if (message.member.voiceChannel) {
    return true
  } else {
    message.channel.send('You need to join a voice channel first!')
    return false
  }
}

const joinChannel = async function (message) {
  const joinable = verifyJoinable(message)
  if (joinable) {
    await discordService.joinVoiceChannel(message.member.voiceChannel)
  }
  return joinable
}

const join = async function (message) {
  if (await joinChannel(message)) {
    if (mopidyService.playing) {
      discordService.streamAudio(mopidyService.currentSong.derived.songString, mopidyService.audioStream)
    }
  }
}

const topBeats = async function (results, number) {
  const first = Math.max(0, number - maxBeats)
  const beats = await Promise.all(
    results.slice(first, number)
      .map((beat) => mopidyService.getSong(beat.uri, beat.points))
  )

  return {beats, first}
}

const kill = async function (message) {
  await message.channel.send('Goodbye, cruel world.')
  await discordService.disconnect()
  mopidyService.disconnect()
  process.exit()
}

const top = async function (message, args) {
  let number = 10
  if (args) {
    number = parseInt(args.split(' ')[0]) || 10
  }

  const results = voteService.getResults()

  const {beats, first} = await topBeats(results, number)

  const playlistUrl = `https://open.spotify.com/user/${config.spotifyUserId}/playlist/${config.spotifyTopPlaylistId}`

  const messages = await beatsTable('Top Beats', beats, {first: first})

  for (const body of messages) {
    await message.channel.send(body)
  }

  message.channel.send(`To see the top 100 beats in Spotify, visit <${playlistUrl}>`)

  spotifyService.updatePlaylist(config.spotifyUserId, config.spotifyTopPlaylistId, results)
}

const bot = async function (message, args) {
  let number = 10
  if (args) {
    number = parseInt(args.split(' ')[0]) || 10
  }

  const results = voteService.getResults()

  const {beats, first} = await topBeats(results.reverse(), number)

  const messages = beatsTable('Bottom Beats', beats, {first: first})

  for (const body of messages) {
    await message.channel.send(body)
  }
}

const ellipse = function (str, max) {
  return str.length > (max - 3) ? str.substring(0, max - 3) + '...' : str
}

const beatsTable = function (title, beats, params) {
  const { index, first } = params || {}

  if (beats.length === 0) {
    return ['No results.']
  }
  const table = new AsciiTable()
    .setHeading('#', 'Name', 'Artist(s)', 'Score')

  beats.forEach((song, i) => {
    const num = i + 1 + (first || 0)
    table.addRow(
      index === i ? `> ${num}` : num,
      ellipse(song.derived.songName, 60),
      ellipse(song.derived.artistString, 40),
      song.points
    )
  })
  const tableLines = table.toString().split('\n')

  let message = `**${title}**\n`

  if (first) {
    message += `*Showing results from ${first + 1} to ${first + beats.length}.*`
  }

  message += '```'
  const messages = []

  for (const line of tableLines) {
    if (message.length + line.length > maxMessageLength - 6) {
      messages.push(message + '```')
      message = '```' + line
    } else {
      message += '\n' + line
    }
  }

  return [...messages, message + '```']
}

const queue = async function (message) {
  const { tracks, index } = await mopidyService.getQueue()
  const songs = await Promise.all(tracks.map(getFullSongData))
  const messages = beatsTable('Queued Tracks', songs, {current: index})

  for (const body of messages) {
    await message.channel.send(body)
  }
}

const skip = async function (message) {
  if (!(await mopidyService.next())) {
    message.channel.send('Out of beats!')
  }
}

const recent = async function (message, args, playNow) {
  if (verifyJoinable(message)) {
    const response = await message.channel.send('Fetching history...')
    const songs = await mopidyService.getRecent()
    songChoice(message, response, songs, playNow)
  }
}

const repeat = async function (message, args, thisSong) {
  if (mopidyService.playing) {
    mopidyService.repeat(thisSong)
  } else {
    message.channel.send('Not currently playing anything.')
  }
}

const commands = {
  stop: {
    action: stop,
    description: 'Stop any currently playing song and clear the playlist.'
  },
  join: {
    action: join,
    description: 'Request the bot join your current voice channel.'
  },
  top: {
    action: top,
    description: 'List the most highly voted songs.'
  },
  bot: {
    action: bot,
    description: 'List the most downvoted songs'
  },
  rand: {
    action: rand,
    description: 'Select a random song that matches the search query.',
    args: ['query'],
    bang: 'Plays immediately rather than adding to the queue.'
  },
  skip: {
    action: skip,
    description: 'Skip the currently playing song.'
  },
  play: {
    action: play,
    description: 'If a unique song matches the query, play it. Otherwise choose out of the top 5 results.',
    args: ['query'],
    bang: 'Plays immediately rather than adding to the queue.'
  },
  recent: {
    action: recent,
    description: 'List the most recent 5 songs played. You may select one to play.'
  },
  upvote: {
    action: upvote,
    description: 'Upvote the currently playing song.'
  },
  downvote: {
    action: downvote,
    description: 'Downvote the currently playing song.'
  },
  repeat: {
    action: repeat,
    description: 'Play the current tracklist on repeat.',
    bang: 'Play only the current song on repeat.'
  },
  queue: {
    action: queue,
    description: 'List the currently queued tracks.'
  },
  kill: {
    action: kill,
    description: 'Terminate the bot. Pray he returns.'
  }
}

discordService.onMessage(commands, async (message, cmd, args, bang) => {
  if (custom.handleMessage) {
    const action = custom.handleMessage(cmd, args, bang)

    if (action) {
      console.log(action)
      if (action.reply) message.channel.send(action.reply)
      if (action.vote > 0) upvote(message)
      if (action.vote < 0) downvote(message)
      if (action.play) playSong(message, {uri: action.play}, action.bang)
      return true
    }
  }
})

discordService.startBot()
