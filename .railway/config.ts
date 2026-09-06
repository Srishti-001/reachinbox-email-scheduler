import { Project } from '@railway/cli'

export default new Project({
  name: 'reachinbox-email-scheduler',
  services: {
    backend: {
      build: {
        builder: 'DOCKERFILE',
        dockerfile: 'Dockerfile.backend',
        context: '.'
      },
      deploy: {
        numReplicas: 1
      },
      port: 4000
    },
    frontend: {
      build: {
        builder: 'DOCKERFILE',
        dockerfile: 'Dockerfile.frontend',
        context: '.'
      },
      deploy: {
        numReplicas: 1
      },
      port: 3000
    }
  }
})
