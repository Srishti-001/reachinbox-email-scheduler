# Frontend Dockerfile for Railway
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build Next.js application
RUN npm run build

# Expose port
EXPOSE 3000

# Start Next.js server
CMD ["npm", "run", "start"]
