FROM rorystok.es:5000/pulse:latest
MAINTAINER OfficialHexix

USER root

RUN  apt-get install -y wget

RUN  wget -q -O - https://deb.nodesource.com/setup_9.x | bash -
RUN  apt-get install -y nodejs ffmpeg git libpulse-dev

USER bb1

WORKDIR /home/bb1/

ADD  package.json package-lock.json /home/bb1/
RUN  npm install

ADD  index.js /home/bb1

ENTRYPOINT nodejs index.js
