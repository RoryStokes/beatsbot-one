import {
  AudioPlayer,
  DiscordGatewayAdapterCreator,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice/dist";
import {
  Channel,
  Client,
  EmbedFieldData,
  Intents,
  Message,
  MessageEmbed,
  MessageEmbedOptions,
  MessageReaction,
  ReactionCollector,
  VoiceChannel,
} from "discord.js";

const goodReactsList = ["📈", "🎺", "💯", "👌", "👍", "🔥", "🥁"];
const badReactsList = ["📉", "👎", "🚢", "🚣", "🚤", "⚓", "💩"];
const goodReacts = new Set(goodReactsList);
const badReacts = new Set(badReactsList);

const randChoice = (list) => list[Math.floor(Math.random() * list.length)];
export type Command = {
  action: (message: Message, args: string, bang: string, alt: string) => void;
  description: string;
  args?: string[];
  bang?: string;
};

export class DiscordService {
  private client: Client;
  private secret: string;
  private idleTimeout: number;
  private voteTimeout: number;
  private currentTextChannel: Channel | undefined;
  private reactCollectors: ReactionCollector[];
  private currentNumberChoice: {
    timeout: NodeJS.Timeout;
    afterChosen;
    numberCollector;
    message;
  };
  private voiceConnection: VoiceConnection;
  private currentVoiceChannel: VoiceChannel;
  private timeout: NodeJS.Timeout;

  constructor(config) {
    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
      ],
    });
    this.secret = config.discordSecret;
    this.idleTimeout = config.idleTimeoutSeconds * 1000;
    this.voteTimeout = config.voteTimeoutSeconds * 1000;
  }

  onMessage(commands: Record<string, Command>, fallback) {
    this.client.on("message", (message) => {
      if (message.author.id === this.client.user.id) {
        return;
      }

      const normalised = message.content.toLowerCase();
      let cmd, bang, alt;
      let args = message.content;

      const match = message.content.match(/^(!+)([\w]+)(?:\((\w+)\))? ?(.*)$/);

      if (match) {
        bang = match[1].length > 1;
        cmd = match[2].toLowerCase();
        alt = match[3];
        args = match[4];

        if (cmd === "help" || cmd === "?") {
          return this.showHelp(message, commands);
        }

        const command = commands[cmd];

        if (command) {
          this.currentTextChannel = message.channel;
          return command.action(message, args, bang, alt);
        }
      }

      if (fallback) {
        if (fallback(message, cmd, args, bang)) {
          this.currentTextChannel = message.channel;
        }
      }
    });
  }

  showHelp(message: Message, commands: Record<string, Command>) {
    console.log(commands);

    const fields = Object.entries(commands).map<EmbedFieldData>(
      ([cmd, command]) => ({
        name: command.args
          ? `!${cmd} ${command.args.map((arg) => `[${arg}]`).join(" ")}`
          : `!${cmd}`,
        value: command.bang
          ? `${command.description}\n(!!) ${command.bang}`
          : command.description,
      })
    );

    const embed: MessageEmbedOptions = {
      title: "Available Commands",
      color: "#08d58f",
      fields,
    };

    message.channel.send({ embeds: [embed] });
  }

  async startBot() {
    await this.client.login(this.secret);
    await this.nowPlaying();
  }

  disconnect() {
    return this.client.destroy();
  }

  postEmbed(embed: MessageEmbedOptions) {
    if (this.currentTextChannel.isText()) {
      this.currentTextChannel.send({ embeds: [embed] });
    }
  }

  reactionHandler(onReact) {
    return (reaction) => {
      const delta = goodReacts.has(reaction._emoji.name) ? 1 : -1;

      for (var userId of reaction.users.keys()) {
        if (userId !== this.client.user.id) {
          onReact(userId, delta);
        }
      }
    };
  }

  reactFilter(reaction, user) {
    const realUser = user.id !== this.client.user.id;
    const knownReact =
      goodReacts.has(reaction._emoji.name) ||
      badReacts.has(reaction._emoji.name);

    return realUser && knownReact;
  }

  clearCollectors() {
    for (var collector of this.reactCollectors) {
      collector.stop();
    }
    this.reactCollectors = [];
  }

  emojiForNumber(n) {
    if (n < 0 || n > 9) {
      throw Error(
        `Number emojis only exist for zero to ten, ${n} is outside of the valid range.`
      );
    }
    return n < 9 ? `${n + 1}⃣` : "🔟";
  }

  numberForEmoji(e) {
    if (e.name === "🔟") return 10;
    else if (e.name[1] === "⃣") {
      return parseInt(e.name[0]);
    }
    throw Error(`[${e.name} is not a recognised numeric emoji`);
  }

  async handleChosenNumber(reaction?: MessageReaction) {
    if (this.currentNumberChoice) {
      const { timeout, afterChosen, numberCollector, message } =
        this.currentNumberChoice;
      clearTimeout(timeout);
      numberCollector.stop();
      await message.clearReactions();

      if (reaction && reaction.emoji.name !== "❌") {
        // A number was chosen, so we must handle the response.
        const number = this.numberForEmoji(reaction);
        afterChosen(number - 1);
      }
    }
  }

  async chooseNumber(message, max, afterChosen) {
    console.log(`Choosing out of ${max}`);
    const numbers = [...Array(max).keys()];
    const emojis = [...numbers.map(this.emojiForNumber), "❌"];
    const numberCollector = message.createReactionCollector(
      (r, u) => u.id !== this.client.user.id && emojis.includes(r._emoji.name)
    );

    if (this.currentNumberChoice) {
      this.handleChosenNumber();
    }

    const timeout = setTimeout(
      this.handleChosenNumber.bind(this),
      this.voteTimeout
    );
    this.currentNumberChoice = {
      timeout,
      afterChosen,
      numberCollector,
      message,
    };
    numberCollector.on("collect", this.handleChosenNumber.bind(this));

    await this.addEmojis(numberCollector, emojis);
  }

  async addEmojis(collector, emojis) {
    if (!collector.ended) {
      await collector.message.react(emojis[0]);
      if (emojis.length > 1) await this.addEmojis(collector, emojis.slice(1));
    }
  }

  async nowPlaying(text?: string) {
    if (text) {
      console.log("now playing", text);
      await this.client.user.setPresence({
        status: "online",
        activities: [
          {
            name: text,
            type: "LISTENING",
          },
        ],
      });
    } else {
      await this.client.user.setPresence({
        status: "idle",
      });
    }
  }

  async joinVoiceChannel(channel: VoiceChannel) {
    if (
      this.voiceConnection &&
      (!this.currentVoiceChannel || this.currentVoiceChannel.id !== channel.id)
    ) {
      this.leaveVoiceChannel();
    }

    clearTimeout(this.timeout);
    this.currentVoiceChannel = channel;

    if (!this.voiceConnection) {
      this.voiceConnection = await joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });
    }

    this.timeout = setTimeout(
      this.leaveVoiceChannel.bind(this),
      this.idleTimeout
    );
  }

  async leaveVoiceChannel() {
    if (this.voiceConnection) this.voiceConnection.disconnect();
    this.voiceConnection = null;
    this.currentVoiceChannel = null;
  }

  async startAudio(channel: VoiceChannel, audioPlayer: AudioPlayer) {
    await this.joinVoiceChannel(channel);
    console.log("SUBSCRIBING VOICE CONNECTION");
    this.voiceConnection.subscribe(audioPlayer);
    console.log(audioPlayer.state);
    console.log(this.voiceConnection.state);
  }

  // async streamAudio(stream, name?) {
  //   if (this.voiceConnection) {
  //     if (name) {
  //       await this.nowPlaying(name);
  //     }
  //     clearTimeout(this.timeout);
  //     // if (!(this.currentStream && this.currentStream.playing)) {
  //     //   this.currentStream = stream;
  //     //   try {
  //     //     this.voiceConnection.playConvertedStream(stream);
  //     //   } catch (e) {
  //     //     console.log("failed to start audio stream", e);
  //     //   }
  //     // }
  //   }
  // }

  async stopAudio() {
    clearTimeout(this.timeout);
    this.nowPlaying();
    this.timeout = setTimeout(
      this.leaveVoiceChannel.bind(this),
      this.idleTimeout
    );
  }
}

export default DiscordService;
