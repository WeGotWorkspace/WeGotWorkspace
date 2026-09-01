export type MeetCallStageLayout = "side-by-side" | "fullscreen" | "collapsed";

export function meetCallStageShowsChat(layout: MeetCallStageLayout): boolean {
  return layout !== "fullscreen";
}

export function meetCallStageShowsStage(layout: MeetCallStageLayout): boolean {
  return layout !== "collapsed";
}
