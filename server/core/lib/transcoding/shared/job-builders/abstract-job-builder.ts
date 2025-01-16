import { ffprobePromise } from '@peertube/peertube-ffmpeg'
import { VideoResolution } from '@peertube/peertube-models'
import { computeOutputFPS } from '@server/helpers/ffmpeg/framerate.js'
import { logger, loggerTagsFactory } from '@server/helpers/logger.js'
import { CONFIG } from '@server/initializers/config.js'
import { DEFAULT_AUDIO_MERGE_RESOLUTION, DEFAULT_AUDIO_RESOLUTION } from '@server/initializers/constants.js'
import { Hooks } from '@server/lib/plugins/hooks.js'
import { VideoPathManager } from '@server/lib/video-path-manager.js'
import { MUserId, MVideoFile, MVideoFullLight } from '@server/types/models/index.js'
import { canDoQuickTranscode } from '../../transcoding-quick-transcode.js'
import { buildOriginalFileResolution, computeResolutionsToTranscode } from '../../transcoding-resolutions.js'

const lTags = loggerTagsFactory('transcoding')

export abstract class AbstractJobBuilder <P> {

  async createOptimizeOrMergeAudioJobs(options: {
    video: MVideoFullLight;
    videoFile: MVideoFile;
    isNewVideo: boolean;
    user: MUserId;
    videoFileAlreadyLocked: boolean;
  }) {
    const { video, videoFile, isNewVideo, user, videoFileAlreadyLocked } = options;
  
    let children: P[][] = [];
  
    const mutexReleaser = videoFileAlreadyLocked
      ? () => {}
      : await VideoPathManager.Instance.lockFiles(video.uuid);
  
    try {
      await video.reload();
      await videoFile.reload();
  
      await VideoPathManager.Instance.makeAvailableVideoFile(
        videoFile.withVideoOrPlaylist(video),
        async (videoFilePath) => {
          const probe = await ffprobePromise(videoFilePath);
          const quickTranscode = await canDoQuickTranscode(
            videoFilePath,
            CONFIG.TRANSCODING.FPS.MAX,
            probe
          );
  
          let maxFPS: number;
          let maxResolution: number;
          let hlsAudioAlreadyGenerated = false;
  
          if (videoFile.isAudio()) {
            maxFPS = Math.min(
              DEFAULT_AUDIO_MERGE_RESOLUTION,
              CONFIG.TRANSCODING.FPS.MAX
            );
            maxResolution = DEFAULT_AUDIO_RESOLUTION;
          } else {
            const inputFPS = videoFile.fps;
            maxResolution = buildOriginalFileResolution(videoFile.resolution);
            maxFPS = computeOutputFPS({
              inputFPS,
              resolution: maxResolution,
              isOriginResolution: true,
              type: "vod",
            });
          }
  
          // Создаем задачи HLS
          if (CONFIG.TRANSCODING.HLS.ENABLED === true) {
            const hasSplitAudioTranscoding =
              CONFIG.TRANSCODING.HLS.SPLIT_AUDIO_AND_VIDEO &&
              videoFile.hasAudio();
  
            const copyCodecs = !quickTranscode;
  
            const hlsPayloads: P[] = [];
  
            hlsPayloads.push(
              this.buildHLSJobPayload({
                deleteWebVideoFiles:
                  !CONFIG.TRANSCODING.WEB_VIDEOS.ENABLED &&
                  !hasSplitAudioTranscoding,
                separatedAudio: CONFIG.TRANSCODING.HLS.SPLIT_AUDIO_AND_VIDEO,
                copyCodecs,
                resolution: maxResolution,
                fps: maxFPS,
                video,
                isNewVideo,
              })
            );
  
            if (hasSplitAudioTranscoding) {
              hlsAudioAlreadyGenerated = true;
  
              hlsPayloads.push(
                this.buildHLSJobPayload({
                  deleteWebVideoFiles:
                    !CONFIG.TRANSCODING.WEB_VIDEOS.ENABLED,
                  separatedAudio:
                    CONFIG.TRANSCODING.HLS.SPLIT_AUDIO_AND_VIDEO,
                  copyCodecs,
                  resolution: 0,
                  fps: 0,
                  video,
                  isNewVideo,
                })
              );
            }
  
            children.push(hlsPayloads);
          }
  
          // Создаем задачи Web Video
          if (CONFIG.TRANSCODING.WEB_VIDEOS.ENABLED === true) {
            const webVideoPayloads: P[] = [];
  
            webVideoPayloads.push(
              this.buildWebVideoJobPayload({
                resolution: maxResolution,
                fps: maxFPS,
                video,
                isNewVideo,
              })
            );
  
            children.push(webVideoPayloads);
          }
  
          // Задачи на более низкие разрешения
          const lowerResolutionJobPayloads =
            await this.buildLowerResolutionJobPayloads({
              video,
              inputVideoResolution: maxResolution,
              inputVideoFPS: maxFPS,
              hasAudio: videoFile.hasAudio(),
              isNewVideo,
              hlsAudioAlreadyGenerated,
            });
  
          children = children.concat(lowerResolutionJobPayloads);
        }
      );
    } finally {
      mutexReleaser();
    }
  
    // Если children пуст, добавляем пустую задачу
    const payloads: [[P], ...P[][]] = children.length
      ? [[children[0][0]], ...children.slice(1)] // Берем первый элемент как [P], а остальные оставляем
      : [[[] as P]]; // Пустой элемент для соответствия типу в случае отсутствия задач
  
    await this.createJobs({
      payloads,
      user,
      video,
    });
  }

  async createTranscodingJobs (options: {
    transcodingType: 'hls' | 'web-video'
    video: MVideoFullLight
    resolutions: number[]
    isNewVideo: boolean
    user: MUserId | null
  }) {
    const { video, transcodingType, resolutions, isNewVideo } = options
    const separatedAudio = CONFIG.TRANSCODING.HLS.SPLIT_AUDIO_AND_VIDEO

    const maxResolution = Math.max(...resolutions)
    const childrenResolutions = resolutions.filter(r => r !== maxResolution)

    logger.info('Manually creating transcoding jobs for %s.', transcodingType, { childrenResolutions, maxResolution, ...lTags(video.uuid) })

    const inputFPS = video.getMaxFPS()

    const children = childrenResolutions
      .map(resolution => {
        const fps = computeOutputFPS({ inputFPS, resolution, isOriginResolution: maxResolution === resolution, type: 'vod' })

        if (transcodingType === 'hls') {
          // We'll generate audio resolution in a parent job
          if (resolution === VideoResolution.H_NOVIDEO && separatedAudio) return undefined

          return this.buildHLSJobPayload({ video, resolution, fps, isNewVideo, separatedAudio })
        }

        if (transcodingType === 'web-video') {
          return this.buildWebVideoJobPayload({ video, resolution, fps, isNewVideo })
        }

        throw new Error('Unknown transcoding type')
      })
      .filter(r => !!r)

    const fps = computeOutputFPS({ inputFPS, resolution: maxResolution, isOriginResolution: true, type: 'vod' })

    const parent = transcodingType === 'hls'
      ? this.buildHLSJobPayload({ video, resolution: maxResolution, fps, isNewVideo, separatedAudio })
      : this.buildWebVideoJobPayload({ video, resolution: maxResolution, fps, isNewVideo })

    // Low resolutions use the biggest one as ffmpeg input so we need to process max resolution (with audio) independently
    const payloads: [ [ P ], ...(P[][]) ] = [ [ parent ] ]

    // Process audio first to not override the max resolution where the audio stream will be removed
    if (transcodingType === 'hls' && separatedAudio) {
      payloads.unshift([ this.buildHLSJobPayload({ video, resolution: VideoResolution.H_NOVIDEO, fps, isNewVideo, separatedAudio }) ])
    }

    if (children && children.length !== 0) payloads.push(children)

    await this.createJobs({ video, payloads, user: null })
  }

  private async buildLowerResolutionJobPayloads (options: {
    video: MVideoFullLight
    inputVideoResolution: number
    inputVideoFPS: number
    hasAudio: boolean
    isNewVideo: boolean
    hlsAudioAlreadyGenerated: boolean
  }) {
    const { video, inputVideoResolution, inputVideoFPS, isNewVideo, hlsAudioAlreadyGenerated, hasAudio } = options

    // Create transcoding jobs if there are enabled resolutions
    const resolutionsEnabled = await Hooks.wrapObject(
      computeResolutionsToTranscode({ input: inputVideoResolution, type: 'vod', includeInput: false, strictLower: true, hasAudio }),
      'filter:transcoding.auto.resolutions-to-transcode.result',
      options
    )

    logger.debug('Lower resolutions built for %s.', video.uuid, { resolutionsEnabled, ...lTags(video.uuid) })

    const sequentialPayloads: P[][] = []

    for (const resolution of resolutionsEnabled) {
      const fps = computeOutputFPS({
        inputFPS: inputVideoFPS,
        resolution,
        isOriginResolution: resolution === inputVideoResolution,
        type: 'vod'
      })

      let generateHLS = CONFIG.TRANSCODING.HLS.ENABLED
      if (resolution === VideoResolution.H_NOVIDEO && hlsAudioAlreadyGenerated) generateHLS = false

      const parallelPayloads: P[] = []

      if (CONFIG.TRANSCODING.WEB_VIDEOS.ENABLED) {
        parallelPayloads.push(
          this.buildWebVideoJobPayload({
            video,
            resolution,
            fps,
            isNewVideo
          })
        )
      }

      // Create a subsequent job to create HLS resolution that will just copy web video codecs
      if (generateHLS) {
        parallelPayloads.push(
          this.buildHLSJobPayload({
            video,
            resolution,
            fps,
            isNewVideo,
            separatedAudio: CONFIG.TRANSCODING.HLS.SPLIT_AUDIO_AND_VIDEO,
            copyCodecs: false
          })
        )
      }

      if (parallelPayloads.length !== 0) {
        sequentialPayloads.push(parallelPayloads)
      }
    }

    return sequentialPayloads
  }

  // ---------------------------------------------------------------------------

  protected abstract createJobs (options: {
    video: MVideoFullLight
    payloads: [ [ P ], ...(P[][]) ] // Array of sequential jobs to create that depend on parent job
    user: MUserId | null
  }): Promise<void>

  protected abstract buildMergeAudioPayload (options: {
    video: MVideoFullLight
    inputFile: MVideoFile
    isNewVideo: boolean
    resolution: number
    fps: number
  }): P

  protected abstract buildOptimizePayload (options: {
    video: MVideoFullLight
    isNewVideo: boolean
    quickTranscode: boolean
    inputFile: MVideoFile
    resolution: number
    fps: number
  }): P

  protected abstract buildHLSJobPayload (options: {
    video: MVideoFullLight
    resolution: number
    fps: number
    isNewVideo: boolean
    separatedAudio: boolean
    deleteWebVideoFiles?: boolean // default false
    copyCodecs?: boolean // default false
  }): P

  protected abstract buildWebVideoJobPayload (options: {
    video: MVideoFullLight
    resolution: number
    fps: number
    isNewVideo: boolean
  }): P

}
