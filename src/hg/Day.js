// Copyright 2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)

/**
 * @description Information about a single game day that was simulated.
 * @memberof HungryGames
 * @inner
 */
class Day {
  /**
   * @description Create a basic game day.
   * @param {number} [num] The day number.
   * @param {HungryGames~FinalEvent[]} [events] The events that will take place
   * during
   * this day.
   */
  constructor(num, events) {
    /**
     * The day number this is. (Bloodbath is 0).
     *
     * @public
     * @type {number}
     * @default
     */
    this.num = -1;
    if (typeof num === 'number' && !isNaN(num)) this.num = num;
    /**
     * The state index of this day. 0 is not yet simulated, 1 is currently
     * simulating, and 2-n are the index of the event to show if reduced by 2.
     * (2 = event #0, 3 = event #1).
     *
     * @public
     * @type {number}
     * @default
     */
    this.state = 0;
    /**
     * All events to take place during this day.
     *
     * @public
     * @type {HungryGames~FinalEvent[]}
     * @default
     */
    this.events = events || [];
  }
}

/**
 * Create a Day from an Object. Similar to copy-constructor.
 *
 * @public
 * @param {object} data Day like Object.
 * @returns {HungryGames~Day} Created Day.
 */
Day.from = function(data) {
  if (!data) return new Day();
  const evts = Array.isArray(data.events) ? data.events.slice(0) : undefined;
  const day = new Day(data.num * 1, evts);
  day.state = data.state || 0;
  return day;
};

module.exports = Day;
