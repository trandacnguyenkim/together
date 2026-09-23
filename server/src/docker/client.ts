import Docker from 'dockerode'

// Docker Desktop 4.18+ can leave /var/run/docker.sock unlinked when "allow
// the default socket" is off, with the real socket at
// ~/.docker/run/docker.sock — make the path overridable rather than
// hardcoding the classic default.
export const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
})

export const SANDBOX_IMAGE = 'node:20-alpine'

export interface DockerStatus {
  daemonReachable: boolean
  imagePresent: boolean
  error?: string
}

/** Checked at boot and surfaced as a UI banner — never let a dead daemon or
 *  missing image show up as a raw ECONNREFUSED / 404 mid-demo. */
export const checkDockerStatus = async (): Promise<DockerStatus> => {
  try {
    await docker.ping()
  } catch (err) {
    return { daemonReachable: false, imagePresent: false, error: (err as Error).message }
  }
  try {
    await docker.getImage(SANDBOX_IMAGE).inspect()
    return { daemonReachable: true, imagePresent: true }
  } catch {
    return { daemonReachable: true, imagePresent: false }
  }
}

/** Pull the sandbox base image if it's missing, so the first Run click
 *  doesn't stall ~30s mid-demo. Fire-and-forget from the boot check; logs
 *  progress, doesn't block server startup. */
export const ensureImagePulled = async (): Promise<void> => {
  const status = await checkDockerStatus()
  if (!status.daemonReachable) {
    console.warn(`[docker] daemon unreachable: ${status.error}. Run/Deploy will be unavailable until it starts.`)
    return
  }
  if (status.imagePresent) return
  console.log(`[docker] pulling ${SANDBOX_IMAGE} (first run only)...`)
  await new Promise<void>((resolve, reject) => {
    docker.pull(SANDBOX_IMAGE, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) return reject(err ?? new Error('no pull stream'))
      stream.on('data', () => {}) // drain
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
  })
  console.log(`[docker] ${SANDBOX_IMAGE} ready`)
}
