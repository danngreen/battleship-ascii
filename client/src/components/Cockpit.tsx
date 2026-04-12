import React from "react";
import { Box, Text } from "ink";

const FRAMES = [
`  ┌──────── PERISCOPE ────────┐
  │    .      ~   ~    .     │
  │  ~   .~~~~~~~~~~~.       │
  │    ~~     |||     ~~     │
  │ ~~~~~~~~~~|||~~~~~~~~~~  │
  │           ‾‾‾            │
  └──────────────────────────┘`,
`  ┌──────── PERISCOPE ────────┐
  │      ~    .   ~    .     │
  │   ~~~ ~~~~~~~~~~~ ~~     │
  │     ~~    |||    ~~      │
  │ ~~~~~~~~~~|||~~~~~~~~~~  │
  │           ‾‾‾            │
  └──────────────────────────┘`,
];

export function Cockpit({ phase, cursor }: { phase: string; cursor: { x: number; y: number; z: number } }) {
  const frame = FRAMES[Math.floor(Date.now() / 400) % FRAMES.length];
  return (
    <Box flexDirection="column">
      <Text color="greenBright">{frame}</Text>
      <Text>phase: <Text color="magentaBright">{phase}</Text></Text>
      <Text>target: ({cursor.x}, {cursor.y}, {cursor.z})</Text>
    </Box>
  );
}
