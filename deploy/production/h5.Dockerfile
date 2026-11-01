FROM lenglengyou/delta-game-h5:tagname
RUN rm -rf /usr/share/nginx/html/*
COPY delta-mp/dist/build/h5/ /usr/share/nginx/html/
COPY deploy/production/h5.nginx.conf /etc/nginx/conf.d/default.conf

