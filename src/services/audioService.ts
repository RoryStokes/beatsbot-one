import {
  AudioPlayer,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
} from "@discordjs/voice";
import { FFmpeg } from "prism-media";

type AudioServiceConfig = { maxTransmissionGap: number; audioDevice: string };

export class AudioService {
  private config: AudioServiceConfig;
  private player: AudioPlayer | undefined;

  constructor(config: AudioServiceConfig) {
    this.config = config;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: Math.round(config.maxTransmissionGap / 20),
      },
    });
  }

  playTo(connection: VoiceConnection) {
    this.player.stop();
    
    this.player.play(createAudioResource(
      new FFmpeg({
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
      }),
      { inputType: StreamType.OggOpus }
    ));

    connection.subscribe(this.player);

    return this.player;
  }
}

export default AudioService;
