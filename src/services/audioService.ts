import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
} from "@discordjs/voice/dist";
import { FFmpeg } from "prism-media";

type AudioServiceConfig = { maxTransmissionGap: number; audioDevice: string };

export class AudioService {
  private player: AudioPlayer;
  private config: AudioServiceConfig;

  constructor(config: AudioServiceConfig) {
    this.config = config;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: Math.round(config.maxTransmissionGap / 20),
      },
    });
    
    this.player.on('stateChange', (oldState, newState) => {
        if (oldState.status === AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Playing) {
            console.log('Playing audio output on audio player');
        } else if (newState.status === AudioPlayerStatus.Idle) {
            console.log('Playback has stopped. Attempting to restart.');
            this.attachRecorder();
        }
    });

    this.attachRecorder();
  }

  getPlayer() {
      return this.player;
  }

  attachRecorder() {
    this.player.play(
      createAudioResource(
        new FFmpeg({
          args: [
            "-analyzeduration",
            "0",
            "-loglevel",
            "0",
            "-f",
            "dshow",
            "-i",
            `audio=${this.config.audioDevice}`,
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
        {
          inputType: StreamType.OggOpus,
        }
      )
    );
    console.log("Attached recorder - ready to go!");
  }
}

export default AudioService;
