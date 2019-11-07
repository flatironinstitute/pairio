FROM node:12
EXPOSE 8080

RUN mkdir /src
COPY package.json /src/package.json
COPY server /src/server
WORKDIR /src
RUN npm install

CMD ["npm", "run", "start-docker"]