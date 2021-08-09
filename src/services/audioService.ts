import { VoiceConnection } from "discord.js";
import { FFmpeg } from "prism-media";

type AudioServiceConfig = { maxTransmissionGap: number; audioDevice: string };

export class AudioService {
  private config: AudioServiceConfig;

  constructor(config: AudioServiceConfig) {
    this.config = config;
  }

  playTo(connection: VoiceConnection) {
      return connection.play(new FFmpeg({
        args: [
          "-analyzeduration",
          "0",
          "-loglevel",
          "0",
          "-f",
          "pulse",
          "-i",
          this.config.audioDevice,
          "-acodec",
          "libopus",
          "-f",
          "opus",
          "-ar",
          "48000",
          "-ac",
          "2",
        ],
      }), {type: "ogg/opus"});
  }
}

export default AudioService;
