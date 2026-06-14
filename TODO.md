- add backend database for persistent storage. likely postgresql. maybe redis as well? (major ai task maybe wait for fable 5 again)
- make it so generation doesn't halt when the browser tab closes (probably needs backend database done first)

- implement user authentication and access controls (major ai task maybe wait for fable 5 again)

- add tasks, this is somewhat agentic, maybe wait until the basics of workspace are implemented? have tasks run on a schedule, basically gives a agentic session a prompt to run periodically and may alter states I guess? for example: one that is intended to consolidate and delete duplicate or contradictory memories

- make it so the + button for a new tab dropdown doesn't extend off screen (will translate left to avoid being off screen). particularly problematic on mobile
- make it so windows can't be moved off screen
- fix the total time generating duration (I think it isn't counting thinking time) also investigate the other specs. tok/s should be accurate, toks out is probably correct, context unsure how that works
- get rid of keybind text on mobile
- make the side-bar on mobile swipeable to close
- make it so on mobile, the buttons like check boxes and slider check boxes are larger, and have a slightly larger hitbox to register a click). and in general most buttons on mobile should be larger.
