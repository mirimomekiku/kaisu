export interface FriendlyError {
  summary: string;
  hint?: string;
}

const RULES: Array<[RegExp, FriendlyError]> = [
  [
    /sign in to confirm|private video|login required|members-only|confirm your age|age.restricted|requires authentication/i,
    {
      summary: "This video needs you to be signed in.",
      hint: "It may be private, members-only or age-restricted. Advanced mode can use your browser's login.",
    },
  ],
  [/not available in your country|geo.?restrict|blocked it in your country/i, { summary: "This video isn't available in your country." }],
  [
    /video unavailable|is not available|has been removed|no longer available|does not exist|been terminated|http error 404/i,
    { summary: "This video isn't available.", hint: "It may have been removed or made private." },
  ],
  [/unsupported url/i, { summary: "That link isn't a video Kaisu can download.", hint: "Check that you copied the full link to the video page." }],
  [/http error 429|too many requests/i, { summary: "The website is limiting requests.", hint: "Wait a few minutes and try again." }],
  [/http error 403|forbidden/i, { summary: "The website refused the download.", hint: "Try again later. Updating the download engine can also help." }],
  [
    /getaddrinfo|name or service not known|temporary failure in name resolution|network is unreachable|timed out|connection (reset|refused|aborted)|unable to download (webpage|json)|couldn't reach|check your internet/i,
    { summary: "Couldn't connect.", hint: "Check your internet connection and try again." },
  ],
  [/no space left|disk full|not enough space/i, { summary: "Your disk is full.", hint: "Free up some space or pick another folder in Settings." }],
  [/permission denied|access is denied|read-only file system/i, { summary: "Kaisu can't save to that folder.", hint: "Choose a different download folder in Settings." }],
  [/ffmpeg|ffprobe|postprocessing/i, { summary: "A helper tool needed to finish this download is missing or failed.", hint: "Open Setup to reinstall the helper tools." }],
  [/isn't installed yet|open setup/i, { summary: "Kaisu needs to finish setting up.", hint: "Open Setup to install the helper tools." }],
  [/type something to search/i, { summary: "Type something to search for." }],
  [/enter a full web link/i, { summary: "That doesn't look like a web link.", hint: "Paste the full address, starting with https://" }],
];

/** Turns raw yt-dlp output into a short, plain-language message. */
export function friendlyError(raw: string): FriendlyError {
  for (const [pattern, friendly] of RULES) {
    if (pattern.test(raw)) return friendly;
  }
  return { summary: "Something went wrong.", hint: "Try again. If it keeps happening, show the details below." };
}

const PERMANENT = /private|sign in|login|members-only|age.restricted|unavailable|not available|removed|copyright|unsupported url|does not exist|enter a full web link|no space|permission denied|invalid|isn't installed|not allowed|too long|can't be found|choose/i;
const TRANSIENT = /timed out|timeout|connection (reset|refused|aborted)|network is unreachable|temporary failure|unable to download|getaddrinfo|name or service|http error (5\d\d|429)|too many requests|ssl|incomplete|broken pipe|eof|couldn't reach/i;

/** Is this failure the kind that often goes away if tried again a little later? */
export function isTransient(message: string): boolean {
  if (/http error (5\d\d|429)|too many requests/i.test(message)) return true;
  return TRANSIENT.test(message) && !PERMANENT.test(message);
}

/** Seconds to wait before retry number `attempt` (1, 2, 3...): 5, 15, 45, then a minute. */
export const retryDelaySeconds = (attempt: number) => [5, 15, 45][attempt - 1] ?? 60;
