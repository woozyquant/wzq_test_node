/**
 * RgthreeLoraInfoDialog - Dialog class for displaying Lora information
 */
export class MyRgthreeLoraInfoDialog {
  /**
   * Constructor
   * @param {string} loraName - The name of the lora to display
   */
  constructor(loraName) {
    this.loraName = loraName;
  }

  /**
   * Show dialog with lora name
   */
  show() {
    alert(this.loraName);
  }
}
