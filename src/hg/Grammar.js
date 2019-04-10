// Copyright 2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)

/**
 * @classdesc Grammar related string formatting.
 * @class HungryGames~Grammar
 */
function Grammar() {}
/**
 * Format an array of users into names based on options and grammar rules.
 *
 * @public
 * @param {HungryGames~Player[]} names An array of players to format the names
 * of.
 * @param {string} [format='username'] Setting of how to format the user's name.
 * `username` will use their account name, `mention` will use their ID to format
 * a mention tag, `nickname` will use their custom guild nickname.
 * @return {string} The formatted string of names.
 */
Grammar.formatMultiNames = function(names, format = 'username') {
  let output = '';
  for (let i = 0; i < names.length; i++) {
    if (format === 'mention' && !names[i].isNPC) {
      output += '<@' + names[i].id + '>';
    } else if (format === 'nickname') {
      output += '`' + (names[i].nickname || names[i].name) + '`';
    } else {
      output += '`' + names[i].name + '`';
    }

    if (i == names.length - 2) {
      output += ', and ';
    } else if (i != names.length - 1) {
      output += ', ';
    }
  }
  return output;
};
module.exports = Grammar;
