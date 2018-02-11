const Discord = require('discord.js')

const goodReactsList = ['📈', '🎺', '💯', '👌', '👍', '🔥', '🥁']
const badReactsList = ['📉', '👎', '🚢', '🚣', '🚤', '⚓', '💩']
const goodReacts = new Set(goodReactsList)
const badReacts = new Set(badReactsList)

const randChoice = (list) => list[Math.floor(Math.random() * list.length)]

class DiscordService {
  constructor (config) {
    this.client = new Discord.Client()
    this.secret = config.discordSecret
    this.reactCollectors = []
    this.idleTimeout = config.idleTimeoutSeconds * 1000
  }

  onMessage (commands, fallback) {
    this.client.on('message', message => {
      if (message.author.id === this.client.user.id) {
        return
      }

      const normalised = message.content.toLowerCase()
      let cmd, bang
      let args = message.content

      if (message.content[0] === '!') {
        const idx = normalised.indexOf(' ')
        const firstSpace = (idx === -1) ? normalised.length : idx

        bang = (message.content[1] === '!')
        cmd = normalised.substring(bang ? 2 : 1, firstSpace)
        console.log(`'${cmd}'`)
        args = message.content.substring(firstSpace + 1)

        if (cmd === 'help' || cmd === '?') {
          return this.showHelp(message, commands)
        }

        const command = commands[cmd]

        if (command) {
          this.currentTextChannel = message.channel
          return command.action(message, args, bang)
        }
      }

      if (fallback) {
        if (fallback(message, cmd, args, bang)) {
          this.currentTextChannel = message.channel
        }
      }
    })
  }

  showHelp (message, commands) {
    console.log(commands)
    const embed = this.embed()
      .setTitle('Available Commands')
      .setColor('#08d58f')

    for (const [cmd, command] of Object.entries(commands)) {
      const usageString = command.args ? `!${cmd} ${command.args.map(arg => `[${arg}]`).join(' ')}` : `!${cmd}`
      const descriptionString = command.bang ? `${command.description}\n(!!) ${command.bang}` : command.description
      embed.addField(usageString, descriptionString)
    }

    message.channel.send({embed})
  }

  async startBot () {
    await this.client.login(this.secret)
    await this.nowPlaying()
  }

  disconnect () {
    return this.client.destroy()
  }

  postEmbed (embed, message) {
    return message ? message.edit('', embed) : this.currentTextChannel.send({embed})
  }

  reactionHandler (onReact) {
    return (reaction) => {
      const delta = goodReacts.has(reaction._emoji.name) ? 1 : -1

      for (var userId of reaction.users.keys()) {
        if (userId !== this.client.user.id) {
          onReact(userId, delta)
        }
      }
    }
  }

  reactFilter (reaction, user) {
    const realUser = user.id !== this.client.user.id
    const knownReact = goodReacts.has(reaction._emoji.name) || badReacts.has(reaction._emoji.name)

    return realUser && knownReact
  }

  async collectReactionsForMessage (message, onReact, initialSentiment) {
    const collector = await message.createReactionCollector(this.reactFilter)
    collector.on('collect', this.reactionHandler(onReact))

    if (initialSentiment) {
      const emoji = initialSentiment > 0 ? randChoice(goodReactsList) : randChoice(badReactsList)
      await message.react(emoji)
    } else {
      await message.react('🎺')
      await message.react('⚓')
    }

    this.reactCollectors.push(collector)
  }

  clearCollectors () {
    for (var collector of this.reactCollectors) {
      collector.stop()
    }
    this.reactCollectors = []
  }

  async chooseNumber (message, max, afterChosen) {
    console.log(`Choosing out of ${max}`)
    const emojis = [...Array(max).keys()].map(x => `${x + 1}⃣`)
    const numberCollector = message.createReactionCollector((r, u) => u.id !== this.client.user.id && emojis.includes(r._emoji.name))
    numberCollector.on('collect', (r, u) => {
      numberCollector.stop()
      message.clearReactions()
      afterChosen(parseInt(r._emoji.name.slice(0, -1)) - 1)
    })

    await this.addEmojis(numberCollector, emojis)
  }

  async addEmojis (collector, emojis) {
    if (!collector.ended) {
      await collector.message.react(emojis[0])
      if (emojis.length > 1) await this.addEmojis(collector, emojis.slice(1))
    }
  }

  async nowPlaying (text) {
    if (text) {
      console.log('now playing', text)
      await this.client.user.setPresence({
        status: 'online',
        game: {
          name: text,
          type: 'LISTENING'
        }
      })
    } else {
      await this.client.user.setPresence({
        status: 'idle',
        game: {}
      })
    }
  }

  embed () {
    return new Discord.RichEmbed()
  }

  async joinVoiceChannel (channel) {
    if (this.voiceConnection && (!this.currentVoiceChannel || this.currentVoiceChannel.id !== channel.id)) {
      this.leaveVoiceChannel()
    }

    clearTimeout(this.timeout)
    this.currentVoiceChannel = channel

    if (!this.voiceConnection) {
      this.voiceConnection = await channel.join()
    }

    this.timeout = setTimeout(this.leaveVoiceChannel.bind(this), this.idleTimeout)
  }

  async leaveVoiceChannel () {
    if (this.voiceConnection) this.voiceConnection.disconnect()
    this.voiceConnection = null
    this.currentVoiceChannel = null
  }

  async streamAudio (name, stream) {
    if (this.voiceConnection) {
      await this.nowPlaying(name)
      clearTimeout(this.timeout)
      if (!(this.currentStream && this.currentStream.playing)) {
        this.currentStream = stream
        try {
          this.voiceConnection.playConvertedStream(stream)
        } catch (e) {
          console.log('failed to start audio stream', e)
        }
      }
    }
  }

  async stopAudio () {
    clearTimeout(this.timeout)
    this.nowPlaying()
    this.timeout = setTimeout(this.leaveVoiceChannel.bind(this), this.idleTimeout)
  }
}

module.exports = DiscordService
