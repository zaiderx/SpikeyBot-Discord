// Copyright 2018-2020 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const fs = require('fs');
const auth = require('../auth.js');
const patreon = require('patreon');
const https = require('https');
require('./subModule.js').extend(Patreon);  // Extends the SubModule class.

/**
 * @classdesc Modifies the {@link SpikeyBot} object with an interface for
 * checking the Patreon status of users.
 * @class
 * @augments SubModule
 * @listens Command#patreon
 */
function Patreon() {
  const self = this;
  /** @inheritdoc */
  this.myName = 'Patreon';

  /** @inheritdoc */
  this.helpMessage = null;

  /**
   * Filename of the file that will store the creator token information for
   * fetching campaign information.
   *
   * @private
   * @default
   * @constant
   * @type {string}
   */
  const tokenFile = './save/patreonCreatorTokens.json';
  /**
   * Cached token values stored in {@link tokenFile}.
   *
   * @private
   * @default
   * @constant
   * @type {{
   *   access_token: string,
   *   refresh_token: string,
   *   expires_at: number,
   *   scope: string,
   *   token_type: string
   * }}
   */
  const tokenData = {};
  /**
   * Cached campaign information that was fetched from Patreon previously.
   *
   * @private
   * @default
   * @constant
   * @type {{
   *   timestamp: number,
   *   data: object
   * }}
   */
  const campaignInfo = {};
  /**
   * The amount of time the {@link campaignInfo} will be cached for before
   * re-fetching from Patreon.
   *
   * @private
   * @default 3 Hours
   * @constant
   * @type {number}
   */
  const campaignCacheTime = 3 * 60 * 60 * 1000;

  /**
   * The filename in the user's directory of the file where the settings related
   * to Patreon rewards are stored.
   *
   * @private
   * @constant
   * @default
   * @type {string}
   */
  const patreonSettingsFilename = '/patreonSettings.json';

  /**
   * Path to the file storing information about each patron tier rewards.
   *
   * @private
   * @constant
   * @default
   * @type {string}
   */
  const patreonTierPermFile = './save/patreonTiers.json';
  /**
   * The parsed data from file about patron tier rewards.
   *
   * @see {@link Patreon~patreonTierPermFile}
   *
   * @private
   * @default
   * @type {Array.<{0: number, 1: string[]}>}
   */
  let patreonTiers = {};

  /**
   * File where the template for the Patreon settings is stored.
   *
   * @see {@link Patreon~patreonSettingsTemplate}
   * @see {@link WebAccount~patreonSettingsTemplate}
   *
   * @private
   * @constant
   * @default
   * @type {string}
   */
  const patreonSettingsTemplateFile = './save/patreonSettingTemplate.json';
  /**
   * The parsed data from {@link Patreon~patreonSettingsTemplateFile}. Data
   * that outlines the available options that can be changed, and their possible
   * values.
   *
   * @private
   *
   * @default
   * @type {object.<object>}
   */
  let patreonSettingsTemplate = {};


  /**
   * Parse tiers from file.
   *
   * @see {@link Patreon~patreonTierPermFile}
   * @private
   */
  function updateTierPerms() {
    fs.readFile(patreonTierPermFile, (err, data) => {
      if (err) {
        self.error('Failed to read ' + patreonTierPermFile);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (!parsed) return;
        patreonTiers = Object.entries(parsed);
      } catch (e) {
        console.error(e);
      }
    });
  }
  updateTierPerms();
  fs.watchFile(patreonTierPermFile, {persistent: false}, (curr, prev) => {
    if (curr.mtime == prev.mtime) return;
    if (self.initialized) {
      self.debug('Re-reading Patreon tier reward information from file');
    } else {
      console.log('Patreon: Re-reading tier reward information from file');
    }
    updateTierPerms();
  });

  /**
   * Parse template from file.
   *
   * @see {@link Patreon~patreonSettingsTemplate}
   * @private
   */
  function updatePatreonSettingsTemplate() {
    fs.readFile(patreonSettingsTemplateFile, (err, data) => {
      if (err) {
        self.error('Failed to read ' + patreonSettingsTemplateFile);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (!parsed) return;
        patreonSettingsTemplate = parsed;
      } catch (e) {
        self.error('Failed to parse ' + patreonSettingsTemplateFile);
        console.error(e);
      }
    });
  }
  updatePatreonSettingsTemplate();
  fs.watchFile(
      patreonSettingsTemplateFile, {persistent: false}, (curr, prev) => {
        if (curr.mtime == prev.mtime) return;
        if (self.initialized) {
          self.debug(
              'Re-reading Patreon setting template information from file');
        } else {
          console.log(
              'Patreon: Re-reading setting template information from file');
        }
        updatePatreonSettingsTemplate();
      });

  /** @inheritdoc */
  this.initialize = function() {
    self.bot.patreon = toExport;
    self.command.on('patreon', commandPatreon);

    self.common.connectSQL();
  };
  /** @inheritdoc */
  this.shutdown = function() {
    self.command.deleteEvent('patreon');

    fs.unwatchFile(patreonTierPermFile);
    fs.unwatchFile(patreonSettingsTemplateFile);
  };

  fs.readFile(tokenFile, (err, data) => {
    if (err) {
      self.error(
          'Failed to read Patreon API token information from file: ' +
          tokenFile);
      console.error(err);
      return;
    }
    try {
      const parsed = JSON.parse(data);
      Object.assign(tokenData, parsed);
    } catch (err) {
      self.error('Failed to parse Patroen API tokens from file: ' + tokenFile);
      console.error(err);
    }
  });

  /**
   * Shows the user's Patreon information to the user.
   *
   * @private
   * @type {commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#patreon
   */
  function commandPatreon(msg) {
    /**
     * Verifies that valid data was found, then fetches all permissions for the
     * user's pledge amount.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: object, message: string}} data The returned data if
     * there was no error.
     */
    function getPerms(err, data) {
      if (err) {
        if (err.startsWith('User has not connected')) {
          self.common.reply(
              msg,
              'If you love SpikeyBot and wish to support SpikeyRobot, please ' +
                  'consider becoming a patron on Patreon!\npatreon.com/Campbe' +
                  'llCrowley\n\nIf you have already pledged, be sure to link ' +
                  'your accounts in order to receive your rewards.\nspikeybot' +
                  '.com/account',
              'https://www.patreon.com/campbellcrowley\nhttps://www.spikeybot' +
                  '.com/account/');
        } else if (err.startsWith('User has never pledged')) {
          self.common.reply(
              msg,
              'You currently have not pledged anything on Patreon.\nIf you lo' +
                  've SpikeyBot, or wish to receive the perks of becoming a p' +
                  'atron, please consider supporting SpikeyRobot on Patreon.',
              'https://www.patreon.com/campbellcrowley');
          return;
        } else {
          self.common.reply(
              msg, 'Oops! Something went wrong while fetching your Patreon ' +
                  'information!',
              err);
        }
        return;
      }
      const pledgeAmount = data.status.pledge;
      if (!pledgeAmount || isNaN(Number(pledgeAmount))) {
        self.common.reply(
            msg,
            'You currently have not pledged anything on Patreon.\nIf you ' +
                'love SpikeyBot, or wish to receive the perks of becoming a ' +
                'patron, please consider supporting SpikeyRobot on Patreon.',
            'https://www.patreon.com/campbellcrowley');
        return;
      }
      toExport.getLevelPerms(pledgeAmount, false, onGetPerms);
    }
    /**
     * Verifies that valid data was found, then fetches all permissions for the
     * user's pledge amount.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: string[], message: string}} data The returned data if
     * there was no error.
     */
    function onGetPerms(err, data) {
      if (err) {
        self.common.reply(
            msg,
            'Oops! Something went wrong while fetching reward information!',
            err);
        return;
      }
      const permString = data.status.join(', ');
      self.common.reply(
          msg, 'Thank you for supporting SpikeyRobot!\n' +
              'Here are your current rewards: ' + permString,
          'https://www.patreon.com/campbellcrowley');
    }
    fetchPatreonRow(msg.author.id, getPerms);
  }

  /**
   * Basic callback function that has two parameters. One with error
   * information, and the other with data if there was no error.
   *
   * @callback Patreon~basicCB
   * @param {?string} err The error string, or null if no error.
   * @param {?{status: *, message: string}} data The returned data if there was
   * no error.
   */

  /**
   * @classdesc The object to put into the {@link SpikeyBot} object. This
   * contains all of the public data available through that interface. Data will
   * be available after {@link Patreon.initialize} has been called, at
   * `SpikeyBot.patreon`.
   * @class
   */
  function toExport() {}

  /**
   * Check that a user or channel or guild has permission for something. Checks
   * overrides for each, and if the user does not have an override, the request
   * is forwarded to {@link toExport.checkPerm}.
   *
   * @public
   *
   * @param {?string|number} uId The Discord user ID to check.
   * @param {?string|number} cId The Discord channel ID to check.
   * @param {?string|number} gId The Discord guild ID to check.
   * @param {?string} perm The permission string to check against. Null to check
   * for overrides only.
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   * @param {boolean} cb.data.status If the given IDs have permission.
   */
  toExport.checkAllPerms = function(uId, cId, gId, perm, cb) {
    switch (gId) {
      case '318603252675379210': // Games
        cb(null, {status: true, message: 'Guild has override.'});
        return;
    }
    switch (cId) {
      case '420045412679024660': // #bottesting
        cb(null, {status: true, message: 'Channel has override.'});
        return;
    }
    switch (uId) {
      case self.common.spikeyId:
      case '126464376059330562': // Rohan
        cb(null, {status: true, message: 'User has override.'});
        return;
    }

    if (uId && perm) {
      toExport.checkPerm(uId, perm, cb);
    } else {
      cb(null, {status: false, message: 'User does not have permission.'});
    }
  };

  /**
   * Fetch all permissions for a given user, channel, or guild.
   *
   * @public
   * @param {?string|number} uId The ID of the Discord user.
   * @param {?string|number} cId The Discord channel ID.
   * @param {?string|number} gId The Discord guild ID.
   * @param {Patreon~basicCB} cb Callback once operation is complete.
   */
  toExport.getAllPerms = function(uId, cId, gId, cb) {
    toExport.checkAllPerms(uId, cId, gId, null, onGetOverrides);
    /**
     * Handle response from checking IDs for overrides.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: boolean, message: string}} info The returned data if
     * there was no error.
     */
    function onGetOverrides(err, info) {
      if (info.status) {
        getPerms(
            null,
            {status: {pledge: Number.MAX_SAFE_INTEGER}, message: info.message});
      } else {
        fetchPatreonRow(uId, getPerms);
      }
    }
    /**
     * Verifies that valid data was found, then fetches all permissions for the
     * user's pledge amount.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: object, message: string}} data The returned data if
     * there was no error.
     */
    function getPerms(err, data) {
      if (err) {
        cb(err, null);
        return;
      }
      const pledgeAmount = data.status.pledge;
      if (!pledgeAmount || isNaN(Number(pledgeAmount))) {
        cb('User is not pledged', null);
        return;
      }
      toExport.getLevelPerms(pledgeAmount, false, onGetPerms);
    }
    /**
     * Verifies that valid data was found, then fetches all permissions for the
     * user's pledge amount.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: string[], message: string}} data The returned data if
     * there was no error.
     */
    function onGetPerms(err, data) {
      if (err) {
        cb(err, null);
        return;
      }
      cb(null, data);
    }
  };

  /**
   * Check that a user has a specific permission. Permissions are defined in
   * {@link Patreon~patreonTierPermFile}. This does not check overrides.
   *
   * @public
   *
   * @param {string|number} uId The Discord user ID to check.
   * @param {string} perm The permission string to check against.
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   * @param {boolean} cb.data.status If the user has permission.
   */
  toExport.checkPerm = function(uId, perm, cb) {
    /**
     * Checks the received data from the Patreon table against the given perm
     * string.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: object, message: string}} data The returned data if
     * there was no error.
     */
    function checkPerm(err, data) {
      if (err) {
        cb(err, data);
        return;
      }
      const pledgeAmount = data.status.pledge;
      if (!pledgeAmount || isNaN(Number(pledgeAmount))) {
        cb(null, {status: false, message: 'User is not currently pledged.'});
        return;
      }
      if (!perm) {
        cb(null, {status: true, message: 'User is patron.'});
        return;
      }
      for (let i = 0; i < patreonTiers.length; i++) {
        for (let j = 0; j < patreonTiers[i][1].length; j++) {
          if (patreonTiers[i][1][j] == perm) {
            if (patreonTiers[i][0] <= pledgeAmount) {
              cb(null, {status: true, message: 'User has permission.'});
              return;
            }
          }
        }
      }
      cb(null, {status: false, message: 'User does not have permission.'});
    }
    fetchPatreonRow(uId, checkPerm);
  };

  /**
   * Responds with all permissions available at the given pledge amount.
   *
   * @public
   *
   * @param {number} pledgeAmount The amount in cents that the user has pledged.
   * @param {boolean} exclusive Only get the rewards received at the exact
   * pledge amount. Does not show all tier rewards below the pledge amount.
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   * @param {string[]} cb.data.status All of the permission strings.
   */
  toExport.getLevelPerms = function(pledgeAmount, exclusive, cb) {
    let output = [];
    for (let i = 0; i < patreonTiers.length; i++) {
      if (patreonTiers[i][0] <= pledgeAmount) {
        if (exclusive && patreonTiers[i][0] != pledgeAmount) continue;
        output = output.concat(patreonTiers[i][1]);
      }
    }
    cb(null, {status: output, message: 'Success'});
  };

  /**
   * Responds with the settings value for a user if they have permission for the
   * setting, otherwise replies with the default value.
   *
   * @public
   *
   * @param {?number|string} uId The user id to check, or null to get the
   * default value.
   * @param {?number|string} cId The Discord channel id to check, or null to get
   * the default value.
   * @param {?number|string} gId The Discord guild id to check, or null to get
   * the default value.
   * @param {string} permString The permission to check with subvalues separated
   * by spaces.
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   * @param {*} cb.data.status The setting's value.
   */
  toExport.getSettingValue = function(uId, cId, gId, permString, cb) {
    const permVals = permString.split(' ');
    const perm = permVals[0];
    if (!patreonSettingsTemplate[perm]) {
      cb('Invalid Permission', null);
      return;
    }
    toExport.checkAllPerms(uId, cId, gId, perm, onCheckPerm);
    /**
     * After check for user perms, this will fetch either the default value, or
     * the user's custom setting.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: boolean, message: string}} info The returned data if
     * there was no error.
     */
    function onCheckPerm(err, info) {
      if (err || !info.status) {
        fetchValue(patreonSettingsTemplate, permVals.concat(['default']), cb);
      } else {
        fs.readFile(
            self.common.userSaveDir + uId + patreonSettingsFilename,
            (err, data) => {
              let parsed = {};
              if (!err) {
                try {
                  parsed = JSON.parse(data);
                } catch (e) {
                  self.error(
                      'Failed to parse user settings file: ' + uId +
                      patreonSettingsFilename);
                  console.error(e);
                  cb('Internal Error', null);
                  return;
                }
              }
              fetchValue(parsed, permVals, onFetchedValue);
            });
      }
    }
    /**
     * Searches an object for the given key values.
     *
     * @private
     * @param {object} obj The object to traverse.
     * @param {string[]} keys The keys to step through.
     * @param {Patreon~basicCB} myCb The callback with the final value.
     */
    function fetchValue(obj, keys, myCb) {
      if (keys.length == 1) {
        myCb(null, {status: obj[keys[0]], message: 'Success'});
        return;
      } else if (typeof obj[keys[0]] === 'undefined') {
        myCb('Invalid Setting: ' + keys[1], null);
        return;
      } else {
        fetchValue(obj[keys[0]], keys.slice(1), myCb);
      }
    }

    /**
     * After a user's setting value has been fetched, check if it has been
     * set, if not then return the default.
     *
     * @private
     * @type {Patreon~basicCB}
     * @param {?string} err The error string, or null if no error.
     * @param {?{status: *, message: string}} info The returned data if
     * there was no error.
     */
    function onFetchedValue(err, info) {
      if (err || typeof info.status === 'undefined') {
        onCheckPerm(null, {status: null, message: 'User value unset'});
      } else {
        cb(null, info);
      }
    }
  };

  /**
   * Get the Patreon information for a given Discord user.
   *
   * @private
   * @param {string|number} uId The Discord user ID to check.
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   * @param {?object} cb.data.status A single row if it was found.
   */
  function fetchPatreonRow(uId, cb) {
    /**
     * SQL query response callback for request to the Discord table.
     *
     * @private
     * @param {Error} err Errors during the query.
     * @param {Array} rows The results of the query.
     */
    function receivedDiscordRow(err, rows) {
      if (err) {
        /* self.error('Failed to lookup user in Discord: ' + uId);
        console.error(err); */
        cb('Failed to find user in database.', null);
        return;
      }
      if (!rows || rows.length != 1) {
        cb('User has not connected their Patreon ' +
               'account to their Discord account.',
        null);
        return;
      }
      const user = rows[0];
      if (!user.patreonId) {
        cb('User has not connected their Patreon ' +
               'account to their Discord account.',
        null);
        return;
      }
      const toSend = global.sqlCon.format(
          'SELECT * FROM Patreon WHERE id=? LIMIT 1', [user.patreonId]);
      global.sqlCon.query(toSend, receivedPatreonRow);
    }
    /**
     * SQL query response callback for request to the Patreon table.
     *
     * @private
     * @param {Error} err Errors during the query.
     * @param {Array} rows The results of the query.
     */
    function receivedPatreonRow(err, rows) {
      if (err) {
        self.error('Failed to lookup user in Patreon: ' + uId);
        console.error(err);
        cb('Failed to find user in database.', null);
        return;
      }
      if (!rows || rows.length != 1) {
        cb('User has never pledged.', null);
        return;
      }
      cb(null, {status: rows[0], message: 'Success'});
    }

    const toSend =
        global.sqlCon.format('SELECT * FROM Discord WHERE id=? LIMIT 1', [uId]);
    global.sqlCon.query(toSend, receivedDiscordRow);
  }

  /**
   * Fetch the campaign information for ourself.
   *
   * @public
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   */
  toExport.fetchCampaign = function(cb) {
    const now = Date.now();
    if (now - campaignInfo.timestamp <= campaignCacheTime) {
      cb(null, {status: campaignInfo.data, message: 'Success'});
      return;
    }
    campaignInfo.timestamp = now;
    fetchAccessToken((err, res) => {
      if (err) {
        cb(err);
        return;
      }
      const accessToken = res.status;
      const patreonAPIClient = patreon.patreon(accessToken);
      patreonAPIClient('/current_user/campaigns?includes=goals')
          .then((data) => {
            // console.log('Data:', data);
            // const store = data.store;
            // const user = store.findAll('user').map((user) =>
            // user.serialize());
            // console.log('user is', user);
            // const campaign = store.findAll('campaign')
            //     .map((campaign) => campaign.serialize());
            const serializable = data.rawJson;
            campaignInfo.data = serializable;
            toExport.fetchCampaign(cb);
          })
          .catch((err) => {
            console.error('error!', err);
            cb(err);
          });
    });
  };

  /**
   * Get the current access token for making a request on our behalf. If the
   * token has expired, it will first be refreshed.
   *
   * @private
   * @param {Patreon~basicCB} cb Callback with parameters for error and success
   * values.
   */
  function fetchAccessToken(cb) {
    if (!tokenData || !tokenData.refresh_token || !tokenData.access_token) {
      cb('No Patreon API tokens');
      return;
    }
    const now = Date.now();
    if (now - tokenData.expires_at < 0) {
      cb(null, {status: tokenData.access_token, message: 'Success'});
      return;
    }
    const host = {
      protocol: 'https:',
      host: 'www.patreon.com',
      path: '/api/oauth2/token?grant_type=refresh_token&refresh_token=' +
          tokenData.refresh_token + '&client_id=' + auth.patreonClientId +
          '&client_secret=' + auth.patreonClientSecret,
      method: 'POST',
      headers: {
        'User-Agent': require('./common.js').ua,
      },
    };

    const req = https.request(host, (res) => {
      let content = '';
      res.on('data', (chunk) => content += chunk);
      res.on('end', () => {
        if (res.statusCode == 200) {
          let parsed;
          try {
            parsed = JSON.parse(content);
          } catch (err) {
            self.error('Failed to parse response from Patreon!');
            console.error(err);
            cb(err);
            return;
          }
          Object.assign(tokenData, parsed);
          /* eslint-disable-next-line @typescript-eslint/camelcase */
          tokenData.expires_at = now + (tokenData.expires_in * 1000);
          self.common.mkAndWrite(
              tokenFile, null, JSON.stringify(tokenData), (err) => {
                if (!err) return;
                self.error(`Failed to save token data to file: ${tokenFile}`);
                console.error(err, tokenData);
              });
          fetchAccessToken(cb);
        } else {
          self.common.error(content);
          cb('Failed to refresh access_token');
          return;
        }
      });
    });
    req.end();
  }
}
module.exports = new Patreon();
