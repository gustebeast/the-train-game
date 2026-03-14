import { File } from 'w3ts';

const LOG_FILE = 'TheTrainGame/debug.txt';
const lines: string[] = [];

export function log(msg: string): void {
  const entry = '[' + os.clock() + '] ' + msg;
  lines.push(entry);
  File.write(LOG_FILE, lines.join('\n'));
  // Only print short messages to game screen to avoid display issues
  if (msg.length < 200) {
    print(msg);
  }
}
