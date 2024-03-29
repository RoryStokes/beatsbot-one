import { joinVoiceChannel, VoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
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
  Snowflake,
  TextBasedChannels,
  TextChannel,
  VoiceChannel,
} from "discord.js";
import { Song } from "./mopidyService";

const goodReactsList = ["📈", "🎺", "💯", "👌", "👍", "🔥", "🥁"];
const badReactsList = ["📉", "👎", "🚢", "🚣", "🚤", "⚓", "💩"];
const goodReacts = new Set(goodReactsList);
const badReacts = new Set(badReactsList);

const randChoice = (list) => list[Math.floor(Math.random() * list.length)];

const jsonPrefix = "```json";
const jsonSuffix = "```";

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
  public currentTextChannel: TextBasedChannels | undefined;
  private currentNumberChoice: {
    timeout: NodeJS.Timeout;
    afterChosen;
    numberCollector;
    message: Message;
  };
  private voiceConnection: VoiceConnection;
  public currentVoiceChannel: VoiceChannel;
  private timeout: NodeJS.Timeout;
  private botChannelId: Snowflake;
  public currentPlayingMessage: Message;
  private afterPlayedEmbed?: MessageEmbedOptions;
  private queuedMessage?: Message;
  private queuedLength: number;

  constructor(config) {
    this.client = new Client({
      intents: [
        "GUILDS",
        "GUILD_MESSAGES",
        "GUILD_MESSAGE_REACTIONS",
        "GUILD_VOICE_STATES",
      ],
    });
    this.secret = config.discordSecret;
    this.idleTimeout = config.idleTimeoutSeconds * 1000;
    this.voteTimeout = config.voteTimeoutSeconds * 1000;
    this.botChannelId = config.botChannelId;
    this.queuedLength = 0;
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

        if (command && message.channel.isText()) {
          this.currentTextChannel = message.channel;
          return command.action(message, args, bang, alt);
        }
      }

      if (fallback) {
        fallback(message, cmd, args, bang);
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
    await this.setIdle();
  }

  disconnect() {
    return this.client.destroy();
  }
  
  async songEnd() {
    await this.shrinkPlayingMessage();
  }

  async postEmbed(embed: MessageEmbedOptions, shrinkTo?: MessageEmbedOptions) {
    const queuedThread = this.queuedMessage?.thread;
    if(queuedThread) {
      queuedThread.setArchived(true);
    }
    this.queuedMessage = undefined;
    if (this.currentTextChannel && this.currentTextChannel.isText()) {
      const message = await this.currentTextChannel.send({ embeds: [embed] });

      this.currentPlayingMessage = message;
      this.afterPlayedEmbed = shrinkTo;
      return message;
    }
  }

  async shrinkPlayingMessage() {
    if (this.currentPlayingMessage && this.afterPlayedEmbed) {
      await this.currentPlayingMessage.edit({
        embeds: [this.afterPlayedEmbed],
      });

      this.afterPlayedEmbed = undefined;
    }
  }

  async addScore(message: Message, score) {
    const embed = new MessageEmbed(message.embeds[0]).addField(
      "Points",
      `${score >= 0 ? "🎺" : "⚓"} ${score}`,
      true
    );
    message.edit({ embeds: [embed] });
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

  async songQueued(song: Song, embed: MessageEmbedOptions) {
    let thread = this.queuedMessage?.thread;
    if(thread) {
      this.queuedLength ++;
      await thread.edit({ name: `Queued ${this.queuedLength} beats`})
    } else if(this.currentTextChannel) {
      this.queuedLength = 1;
      this.queuedMessage = await this.currentTextChannel.send("_ _");
      thread = await this.queuedMessage.startThread({
        name: "Queued a beat",
        autoArchiveDuration: 60
      })
    }

    await thread.send({content: song.derived.songString, embeds: [embed]});
  }

  async nowPlaying(
    song: Song,
    embedMessage?: Message,
    beatEmbed?: MessageEmbedOptions
  ) {
    await this.client.user?.setPresence({
      status: "online",
    });
    await this.client.user?.setActivity({
      name: song.name,
      type: "PLAYING",
    });

    if (embedMessage) {
      const { uri, tags } = this.normaliseUri(song.uri);
      await this.sendBotPayload({
        eventType: "media_posted",
        tags: ["beat", "beats", ...tags],
        uri,
        embed: beatEmbed,
        description: song.name,
        messageId: embedMessage.id,
        channelId: embedMessage.channel.id,
        link: `https://beatsbot.one/play?uri=${encodeURIComponent(uri)}`,
      });
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
    }
  }

  async sendBotPayload(payload: object): Promise<Message | undefined> {
    const botChannel = this.client.channels.cache.get(this.botChannelId);
    if (botChannel?.isText()) {
      return botChannel.send({
        content: [
          jsonPrefix,
          JSON.stringify(payload, null, 2),
          jsonSuffix,
        ].join("\n"),
      });
    }
  }

  getJsonPayload(message: Message): unknown | undefined {
    if (
      message.content.startsWith(jsonPrefix) &&
      message.content.endsWith(jsonSuffix)
    ) {
      try {
        return JSON.parse(
          message.content.substring(
            jsonPrefix.length,
            message.content.length - jsonSuffix.length
          )
        );
      } catch {}
    }
  }

  normaliseUri(uri: string): { uri: string; tags: string[] } {
    const browseLocalPrefix = "file:///home/rory/Dropbox/Chatsongs/";
    const localPrefix = "local:track:";

    const isBrowseLocal = uri.startsWith(browseLocalPrefix);
    const isLocal = uri.startsWith(localPrefix);
    if (isBrowseLocal || isLocal) {
      const path = isBrowseLocal
        ? uri.substr(browseLocalPrefix.length)
        : uri.substr(localPrefix.length);
      const tags = path
        .split("/")
        .slice(0, -1)
        .map((s) => decodeURIComponent(s).split(" ")[0].toLowerCase());
      return {
        uri: `${localPrefix}${path}`,
        tags,
      };
    } else {
      return { uri, tags: [] };
    }
  }

  async setIdle() {
    await this.client.user?.setPresence({
      status: "idle",
    });
    await this.client.user?.setActivity({
      name: "!play",
      type: "LISTENING",
    });
    this.resetTimeout();
  }

  async resetTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(this.stopVoice.bind(this), this.idleTimeout);
  }

  inVoice() {
    return this.voiceConnection && this.voiceConnection.state.status === VoiceConnectionStatus.Ready;
  }

  async startVoice(channel: VoiceChannel) {
    if (
      this.voiceConnection &&
      (!this.currentVoiceChannel || this.currentVoiceChannel.id !== channel.id)
    ) {
      this.stopVoice();
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.currentVoiceChannel = channel;

    if (!this.voiceConnection) {
      this.voiceConnection = await joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });
    }
    this.resetTimeout();
  }

  async stopVoice() {
    if (this.voiceConnection) this.voiceConnection.destroy();
    this.voiceConnection = null;
    this.currentVoiceChannel = null;
    this.currentTextChannel = undefined;
  }

  async startAudio(channel: VoiceChannel) {
    if (channel != this.currentVoiceChannel) {
      await this.startVoice(channel);
    }
    return this.voiceConnection;
  }

  async stopAudio() {
    clearTimeout(this.timeout);
    this.setIdle();
    this.timeout = setTimeout(this.stopVoice.bind(this), this.idleTimeout);
  }
}

export default DiscordService;
