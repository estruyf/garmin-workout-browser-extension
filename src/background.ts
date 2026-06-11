/**
 * The importer UI lives in the content script on connect.garmin.com (a floating
 * button that opens an in-page drawer). Clicking the toolbar icon asks that
 * content script to open the drawer; if the active tab isn't Garmin Connect
 * (no content script to receive the message), we open Garmin Connect instead.
 */

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) {
    chrome.tabs.create({ url: 'https://connect.garmin.com/modern/workouts' })
    return
  }
  chrome.tabs.sendMessage(tab.id, { type: 'open-importer' }).catch(() => {
    chrome.tabs.create({ url: 'https://connect.garmin.com/modern/workouts' })
  })
})
