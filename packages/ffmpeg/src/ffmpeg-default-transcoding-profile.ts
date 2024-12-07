import { getAverageTheoreticalBitrate, getMaxTheoreticalBitrate, getMinTheoreticalBitrate } from '@peertube/peertube-core-utils'
import {
  buildStreamSuffix,
  getAudioStream,
  getMaxAudioBitrate,
  getVideoStream,
  getVideoStreamBitrate,
  getVideoStreamDimensionsInfo,
  getVideoStreamFPS
} from '@peertube/peertube-ffmpeg'
import { EncoderOptionsBuilder, EncoderOptionsBuilderParams } from '@peertube/peertube-models'
import { FfprobeData } from 'fluent-ffmpeg'

const defaultX264VODOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { fps, inputRatio, inputBitrate, resolution } = options

  const targetBitrate = getTargetBitrate({ inputBitrate, ratio: inputRatio, fps, resolution })

  return {
    outputOptions: [
      ...getCommonOutputOptions(targetBitrate),

      `-r ${fps}`
    ]
  }
}

const defaultX264LiveOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { streamNum, fps, inputBitrate, inputRatio, resolution } = options

  const targetBitrate = getTargetBitrate({ inputBitrate, ratio: inputRatio, fps, resolution })

  return {
    outputOptions: [
      ...getCommonOutputOptions(targetBitrate, streamNum),

      `${buildStreamSuffix('-r:v', streamNum)} ${fps}`,
      `${buildStreamSuffix('-b:v', streamNum)} ${targetBitrate}`
    ]
  }
}

const defaultAACOptionsBuilder: EncoderOptionsBuilder = async ({ input, streamNum, canCopyAudio, inputProbe }) => {
  if (canCopyAudio && await canDoQuickAudioTranscode(input, inputProbe)) {
    return { copy: true, outputOptions: [ ] }
  }

  const parsedAudio = await getAudioStream(input, inputProbe)

  // We try to reduce the ceiling bitrate by making rough matches of bitrates
  // Of course this is far from perfect, but it might save some space in the end

  const audioCodecName = parsedAudio.audioStream['codec_name']

  const bitrate = getMaxAudioBitrate(audioCodecName, parsedAudio.bitrate)

  // Force stereo as it causes some issues with HLS playback in Chrome
  const base = [ '-channel_layout', 'stereo' ]

  if (bitrate !== -1) {
    return { outputOptions: base.concat([ buildStreamSuffix('-b:a', streamNum), bitrate + 'k' ]) }
  }

  return { outputOptions: base }
}

const defaultLibFDKAACVODOptionsBuilder: EncoderOptionsBuilder = ({ streamNum }) => {
  return { outputOptions: [ buildStreamSuffix('-q:a', streamNum), '5' ] }
}

export function getDefaultAvailableEncoders () {
  return {
    vod: {
      libsvtav1: {
        default: defaultAV1VODOptionsBuilder
      },
      libx264: {
        default: defaultX264VODOptionsBuilder
      },
      libopus: {
        default: defaultOpusOptionsBuilder
      },
      aac: {
        default: defaultAACOptionsBuilder
      },
      libfdk_aac: {
        default: defaultLibFDKAACVODOptionsBuilder
      }
    },
    live: {
      libx264: {
        default: defaultX264LiveOptionsBuilder
      },
      aac: {
        default: defaultAACOptionsBuilder
      }
    }
  }
}

// AV1 FIRST for VOD, H264 for live. AV1 for live is not implemented yet
export function getDefaultEncodersToTry () {
  return {
    vod: {
      video: [ 'libsvtav1', 'libx264' ],
      audio: [ 'libopus', 'libfdk_aac', 'aac' ]
    },

    live: {
      video: [ 'libx264', 'libsvtav1' ],
      audio: [ 'libfdk_aac', 'aac' ]
    }
  }
}

export async function canDoQuickAudioTranscode (path: string, probe?: FfprobeData): Promise<boolean> {
  const parsedAudio = await getAudioStream(path, probe)

  if (!parsedAudio.audioStream) return true

  if (parsedAudio.audioStream['codec_name'] !== 'aac') return false

  const audioBitrate = parsedAudio.bitrate
  if (!audioBitrate) return false

  const maxAudioBitrate = getMaxAudioBitrate('aac', audioBitrate)
  if (maxAudioBitrate !== -1 && audioBitrate > maxAudioBitrate) return false

  const channelLayout = parsedAudio.audioStream['channel_layout']
  // Causes playback issues with Chrome
  if (!channelLayout || channelLayout === 'unknown' || channelLayout === 'quad') return false

  return true
}

export async function canDoQuickVideoTranscode (path: string, maxFPS: number, probe?: FfprobeData): Promise<boolean> {
  const videoStream = await getVideoStream(path, probe)
  const fps = await getVideoStreamFPS(path, probe)
  const bitRate = await getVideoStreamBitrate(path, probe)
  const resolutionData = await getVideoStreamDimensionsInfo(path, probe)

  // If ffprobe did not manage to guess the bitrate
  if (!bitRate) return false

  // check video params
  if (!videoStream) return false
  if (videoStream['codec_name'] !== 'h264') return false
  if (videoStream['pix_fmt'] !== 'yuv420p') return false
  if (fps < 2 || fps > maxFPS) return false
  if (bitRate > getMaxTheoreticalBitrate({ ...resolutionData, fps })) return false

  return true
}

// ---------------------------------------------------------------------------

function getTargetBitrate (options: {
  inputBitrate: number
  resolution: number
  ratio: number
  fps: number
}) {
  const { inputBitrate, resolution, ratio, fps } = options

  const capped = capBitrate(inputBitrate, getAverageTheoreticalBitrate({ resolution, fps, ratio }))
  const limit = getMinTheoreticalBitrate({ resolution, fps, ratio })

  return Math.max(limit, capped)
}

function capBitrate (inputBitrate: number, targetBitrate: number) {
  if (!inputBitrate) return targetBitrate

  // Add 30% margin to input bitrate
  const inputBitrateWithMargin = inputBitrate + (inputBitrate * 0.3)

  return Math.min(targetBitrate, inputBitrateWithMargin)
}

function getCommonOutputOptions (targetBitrate: number, streamNum?: number) {
  return [
    `-preset veryfast`,
    `${buildStreamSuffix('-maxrate:v', streamNum)} ${targetBitrate}`,
    `${buildStreamSuffix('-bufsize:v', streamNum)} ${targetBitrate * 2}`,

    // NOTE: b-strategy 1 - heuristic algorithm, 16 is optimal B-frames for it
    `-b_strategy 1`,
    // NOTE: Why 16: https://github.com/Chocobozzz/PeerTube/pull/774. b-strategy 2 -> B-frames<16
    `-bf 16`
  ]
}

const defaultOpusOptionsBuilder: EncoderOptionsBuilder = async ({ input, streamNum, canCopyAudio }) => {
  const base = ['-b:a', '320k' ] //'-af', 'loudnorm=I=-14:LRA=11:TP=-1'
  return { outputOptions: base }
}

const defaultAV1VODOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { fps, inputRatio, inputBitrate, resolution } = options

  const targetBitrate = getTargetBitrate({ inputBitrate, ratio: inputRatio, fps, resolution })

  return {
    outputOptions: [
      ...getCommonAV1OutputOptions(resolution, fps, targetBitrate),

      // `-r ${fps}` remove fps controll since we want smooth 60fps even for 480p and 360p
    ]
  }
}

// We use capped CRF, because study shows it's better and more efficient than VBR
// Source: https://streaminglearningcenter.com/articles/learn-to-use-capped-crf-with-svt-av1-for-live-streaming.html

function getCommonAV1OutputOptions (resolution : number, fps : number, targetBitrate: number) {
  switch(resolution) {
    case 2160: {
      return [
        `-preset 4`,
        `-crf 32`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p10le`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 1.5}`,
        `-bufsize:v ${targetBitrate * 3}`,
        // `-b:a 320k`,
      ]
    }
    case 1440: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 4`,
        `-crf 28`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p10le`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 2}`,
        `-bufsize:v ${targetBitrate * 4}`,
        // `-b:a 320k`,
      ]
    }
    case 1080: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 2`,
        `-crf 26`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p10le`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 2.5}`,
        `-bufsize:v ${targetBitrate * 5}`,
        // `-b:a 320k`,
      ]
    }
    case 720: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 2`,
        `-crf 26`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p10le`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 2.3}`,
        `-bufsize:v ${targetBitrate * 4.6}`,
        // `-b:a 256k`,
      ]
    }
    case 480: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 2`,
        `-crf 26`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 2.3}`,
        `-bufsize:v ${targetBitrate * 4.6}`,
        // `-b:a 196k`,
      ]
    }
    case 360: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 2`,
        `-crf 26`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 3.5}`,
        `-bufsize:v ${targetBitrate * 7}`,
        // `-b:a 128k`,
      ]
    }
    case 240: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 2`,
        `-crf 26`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        `-maxrate:v ${targetBitrate * 5}`,
        `-bufsize:v ${targetBitrate * 10}`,
        // `-b:a 128k`,
      ]
    }
    case 144: {
      return [
        `-sws_flags lanczos+accurate_rnd`,
        `-preset 2`,
        `-crf 26`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        // `-b:a 96k`,
      ]
    }
    default:
      return [
        `-preset 4`,
        `-crf 30`,
        `-g ${fps}*2`,
        `-pix_fmt yuv420p10le`,
        `-svtav1-params tune=0:fast-decode=2:tile-rows=3:tile-columns=4:enable-variance-boost=1`,
        // `-b:a 320k`,
        //`-report`
      ];
  }
}