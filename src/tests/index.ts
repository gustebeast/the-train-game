// Every test module, imported for the registerTest calls it makes. A test
// file that is not listed here never loads, and the VM harness checks this
// list before it boots a VM (scripts/vmtest/TrainVMTest.psm1).
import './damageTest'; // a peasant's tools add no damage
import './burnTest'; // burning train: production lock and wrecked end state
import './shopTest'; // Repair Train purchase effect
import './challengeTest'; // challenge sequencing and payouts
import './fogTest'; // blackout must give the map back at dawn
import './bossBalance'; // final boss balance harness
import './campBattleTest'; // camp scaling balance: scaled camp vs the party, for real
import './dpsTest'; // watch the lobby DPS sparring match
import './lobbyVisionTest'; // lobby scenery must not hand out vision
import './readyTest'; // how long a ready countdown actually runs
import './charmTest'; // Charm and Transmute against a creep camp
import './circleLabelTest'; // a circle's label lives exactly as long as the circle
import './eventDrivenTest'; // board, dealer, boss ending and Union Rules react on events
import './inventoryTest'; // peasant inventory: swaps, purchases, slot moves
import './abilityItemTest'; // Resource Vacuum: holding, vacuuming, keeping
import './salespersonTest'; // Secret Salesperson: buying, upgrading, selling back
import './abilitySpellTest'; // Unholy Frenzy and Imbue With Horse, cast for real
import './muscleMilkTest'; // Muscle Milk: bigger stacks, storage limits kept
import './itemCooldownTest'; // ability item cooldowns survive a drop and a hand-over
import './campTest'; // camp rotation: even levels, one lap per level
import './dayNightTest'; // the clock must stay frozen, lobbies included
import './saveTest'; // a save round trip, as the chooser and -load read it
import './boardWallTest'; // nothing walks, flies or sees off the board
