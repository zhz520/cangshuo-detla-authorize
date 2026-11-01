FROM lenglengyou/delta-game-admin:tagname
RUN rm -rf /usr/share/nginx/html/*
COPY delta-admin-ui/dist/ /usr/share/nginx/html/
COPY deploy/production/admin.nginx.conf /etc/nginx/conf.d/default.conf

