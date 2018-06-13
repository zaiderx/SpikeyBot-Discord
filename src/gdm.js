// Copyright 2018 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const fs = require('fs');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
require('./subModule.js')(GDM); // Extends the SubModule class.

/**
 * @classdesc Manages group DMs.
 * @class
 * @augments SubModule
 */
function GDM() {
  const self = this;
  /** @inheritdoc */
  this.myName = 'GDM';

  let oauthURL = 'https://discordapp.com/oauth2/authorize?client_id=' +
      '318552464356016131&redirect_uri=https%3A%2F%2Fwww.spikeybot.com%2' +
      'Fredirect&response_type=code&scope=gdm.join';

  let app = http.createServer(handler);
  app.on('error', console.error);
  app.listen(8011);

  /**
   * The url to send a received `code` to via `POST` to receive a user's
   * tokens.
   *
   * @private
   * @default
   * @type {{host: string, path: string, protocol: string, method: string}}
   * @constant
   */
  const tokenHost = {
    protocol: 'https:',
    host: 'discordapp.com',
    path: '/api/oauth2/token',
    method: 'POST',
  };

  /**
   * Stores all user tokens.
   *
   * @private
   * @type {Object.<{token: string, id: string, expires_at: number,
   * refreshToken: string}>}
   */
  let tokens = {};
  fs.readFile('./save/gdmTokens.json', function(err, data) {
    if (err) {
      console.error(err);
      return;
    }
    tokens = JSON.parse(data || {});
  });

  /** @inheritdoc */
  this.initialize = function() {
    self.command.on('gdm', commandGDM, true);
    oauthURL = 'https://discordapp.com/oauth2/authorize?client_id=' +
        self.Discord.client.id + '&redirect_uri=https%3A%2F%2Fwww.spikeybot.' +
        'com%2Fredirect&response_type=code&scope=gdm.join';
  };
  /** @inheritdoc */
  this.shutdown = function() {
    app.close();
    self.command.deleteEvent('gdm');
    fs.writeFile(
        './save/gdmTokens.json', JSON.stringify(tokens), console.error);
  };

  /**
   * Handler for all http requests. Used for obtaining OAuth2 codes for tokens.
   *
   * @private
   * @param {http.IncomingMessage} req The client's request.
   * @param {http.ServerResponse} res Our response to the client.
   */
  function handler(req, res) {
    if (req.headers.method !== 'POST') {
      res.writeHead(405);
      res.end('Only POST is accepted.');
    } else if (
        req.headers['content-type'] !== 'application/x-www-form-urlencoded') {
      res.writeHead(400);
      res.end('Only application/x-www-form-urlencoded is acceptable.');
    } else if (req.url.startsWith('/code')) {
      let data = '';
      req.on('data', function(chunk) {
        data += chunk;
      });
      req.on('end', function() {
        let code = '';
        try {
          let parsed = querystring.parse(data);
          code = parsed['code'];
        } catch (err) {
          self.common.error('Failed to parse request: ' + err.message, 'GDM');
          res.writeHead(400);
          res.end('Failed to parse payload.');
          return;
        }
        if (!code) {
          console.log(parsed);
          res.writeHead(400);
          res.end('Request does not contain code.');
          return;
        }
        authorizeRequest(code, function(err, content) {
          if (err) {
            res.writeHead(401);
            res.end(err);
            return;
          }
          receivedLoginInfo(JSON.parse(content));
          res.writeHead(200);
          res.end('Authorized');
        });
      });
      req.on('close', function() {
        res.writeHead(400);
        res.end('Failed to receive full request.');
      });
    } else {
      res.writeHead(404);
      res.end('404');
    }
  }

  /**
   * Received the login credentials for user, store it for later use.
   *
   * @private
   * @param {Object} data User data.
   * @param {string} userId The id of the user the data belongs to.
   */
  function receivedLoginInfo(data, userId) {
    if (data && userId) {
      data.expires_at = data.expires_in * 1000 + Date.now();
      data.expiration_date = Date.now() + (1000 * 60 * 60 * 24 * 7);
      tokens[userId] = data;
      console.log('Received:', data);
    }
  }

  /**
   * Send a https request to discord.
   *
   * @private
   * @param {?Object|string} data The data to send in the request.
   * @param {basicCallback} cb Callback with error, and data arguments.
   * @param {?Object} [host=tokenHost] Request object to override the default
   * with.
   */
  function discordRequest(data, cb, host) {
    host = host || tokenHost;
    let req = https.request(host, (response) => {
      let content = '';
      response.on('data', function(chunk) {
        content += chunk;
      });
      response.on('end', function() {
        if (response.statusCode == 200) {
          cb(null, content);
        } else {
          hg.common.error(response.statusCode + ': ' + content);
          console.log(host, data);
          cb(response.statusCode + ' from discord');
        }
      });
    });
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
    if (data) {
      req.end(querystring.stringify(data));
    } else {
      req.end();
    }
    req.on('error', console.log);
  }

  /**
   * Request new credentials with refresh token from discord.
   *
   * @private
   * @param {string} refresh_token The refresh token used for refreshing
   * credentials.
   * @param {basicCallback} cb The callback from the https request, with an
   * error argument, and a data argument.
   */
  function refreshToken(refresh_token, cb) {
    const data = {
      client_id: self.Discord.id,
      client_secret: self.Discord.secret,
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
      redirect_uri: 'https://www.spikeybot.com/redirect',
    };
    discordRequest(data, cb);
  }

  /**
   * Authenticate with the discord server using a login code.
   *
   * @private
   * @param {string} code The login code received from our client.
   * @param {basicCallback} cb The response from the https request with error
   * and data arguments.
   */
  function authorizeRequest(code, cb) {
    const data = {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: 'https://www.spikeybot.com/redirect',
    };
    discordRequest(data, cb);
  }

  /**
   * Tells the bot to create a group DM with the user and everyone mentioned.
   *
   * @private
   * @type {commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens SpikeyBot~Command#gdm
   */
  function commandGDM(msg) {
    if (!tokens[msg.author.id]) {
      self.common.reply(
          msg, 'All users must give me permission to add them to a group DM. ' +
              'Click the link below to allow me to do so.',
          oauthURL);
      return;
    }
    let users =
        [{user: msg.author.id, accessToken: tokens[msg.author.id].token}];
    let failed = [];
    msg.mentions.users.forEach((u) => {
      if (!tokens[u.id]) {
        failed.push(u.username);
      } else {
        // TODO: If token is stale, refresh it first.
        users.push(
            {user: msg.author.id, accessToken: tokens[msg.author.id].token});
      }
    });
    self.client.user.createGroupDM(users)
        .then((channel) => {
          channel.send('Hello!');
        })
        .catch(console.error);
    if (failed.length > 0) {
      self.common.reply(msg, 'Failed to add: ' + failed.join(', '));
    }
  }
}
module.exports = new GDM();
