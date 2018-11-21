class MathHelper {
  /**
   * @param {number[]} numberArray
   * @returns {number}
   */
  static median(numberArray) {
    numberArray = numberArray.sort()
    if (numberArray.length % 2 === 0) { // array with even number elements
      return (numberArray[numberArray.length/2] + numberArray[(numberArray.length / 2) - 1]) / 2
    } else {
      return numberArray[(numberArray.length - 1) / 2] // array with odd number elements
    }
  }
}

module.exports = MathHelper
