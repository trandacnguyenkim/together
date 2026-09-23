import { Router } from 'express'
import { checkDockerStatus } from '../docker/client.js'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const docker = await checkDockerStatus()
  res.json({
    ok: true,
    docker,
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    cloudflareConfigured: Boolean(
      process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID,
    ),
  })
})
