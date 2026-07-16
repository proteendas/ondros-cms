FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Dev server (paired with volume mount in docker-compose).
# For production: RUN npm run build + CMD ["npm", "start"].
CMD ["npm", "run", "dev"]
