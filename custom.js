/* HandleMessage should return an object with any of the following properties
{
  reply: "String to reply with",
  play: "uri of song to play",
  vote: <integer indicating direction of vote>
}
 */
const handleMessage = function (cmd, args, bang) {
  if (cmd === 'custom') {
    return {reply: '`custom.js` can be modified to add your own message handlers.'}
  }
}

module.exports = {handleMessage}
