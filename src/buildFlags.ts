// The build's environment, read at build time. Erased from the Lua output.
declare const process: { env: { [name: string]: string | undefined } };

/**
 * Whether this build carries the developer tools: the chat cheats (-cheatmode,
 * -boss, -lobby, ...) and the in-game test runner (-test <name>).
 *
 * On by default, because that is what every build so far has been and what
 * the VM test runner needs. `npm run build:release` turns them off for a map
 * meant to be hosted for other people, where any player could otherwise type
 * -cheatmode or -test and wreck the run for everyone.
 *
 * Decided at build time (TRAIN_RELEASE, set by scripts/build.ts), so a release
 * map contains a constant `false` here rather than a check anyone can flip.
 */
export const DEV_TOOLS: boolean = compiletime(() => process.env.TRAIN_RELEASE !== '1');
