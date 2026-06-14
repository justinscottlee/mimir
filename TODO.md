- add backend database for persistent storage. likely postgresql. maybe redis as well? (major ai task maybe wait for fable 5 again)
- make it so generation doesn't halt when the browser tab closes (probably needs backend database done first)

- implement user authentication and access controls (major ai task maybe wait for fable 5 again)

- add tasks, this is somewhat agentic, maybe wait until the basics of workspace are implemented? have tasks run on a schedule, basically gives a agentic session a prompt to run periodically and may alter states I guess? for example: one that is intended to consolidate and delete duplicate or contradictory memories

- figure out why tool chip expanded extends beyond message from (on the right), specifically finding this on a web_search...