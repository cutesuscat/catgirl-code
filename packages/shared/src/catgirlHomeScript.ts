// Catgirl Code keeps its state in ~/.catcode. An older ~/.t3 is renamed to it once, never copied,
// and left as a link to it, so older apps, T3 Code sharing the home, service files, worktrees and
// stored paths keep working. sh here, Node in catgirlHome.ts, one lock file between them. Nothing
// from Node: phones bundle this.
import { CATGIRL_HOME_DIR, LEGACY_HOME_DIR } from "./catgirlRelease.ts";

export const HOME_MOVE_LOCK_SUFFIX = ".move-lock";
export const HOME_MOVE_LOCK_WAIT_SECONDS = 15;
/** A lock whose owner wrote no PID within this many looks belongs to nobody. */
export const HOME_MOVE_UNOWNED_LOOKS = 5;

/**
 * POSIX sh defining `catgirl_home`, which applies the rule and prints the home to use. Call it as
 * `$(catgirl_home)`: it ignores hangups while it moves, and the subshell keeps that from the
 * caller. `mv` runs under the lock after a re-check, so it never moves the old home into the new.
 */
export const CATGIRL_HOME_SHELL_FUNCTION = `catgirl_home_unmoved() {
  [ ! -e "$cg_home" ] && [ ! -L "$cg_home" ] || return 1
  if [ -L "$cg_legacy" ]; then
    case "$(readlink "$cg_legacy" 2>/dev/null || true)" in
      ${CATGIRL_HOME_DIR} | ${CATGIRL_HOME_DIR}/ | "$cg_home" | "$cg_home/") return 1 ;;
    esac
    return 0
  fi
  [ -d "$cg_legacy" ]
}
catgirl_home() {
  cg_home="$HOME/${CATGIRL_HOME_DIR}"
  cg_legacy="$HOME/${LEGACY_HOME_DIR}"
  cg_lock="$cg_home${HOME_MOVE_LOCK_SUFFIX}"
  cg_waited=0
  cg_unowned=0
  trap '' HUP INT TERM PIPE
  while catgirl_home_unmoved; do
    if (set -C; printf '%s\\n' "$$" >"$cg_lock") 2>/dev/null; then
      if ! catgirl_home_unmoved; then
        :
      elif [ -L "$cg_legacy" ]; then
        ln -s "$(readlink "$cg_legacy")" "$cg_home" 2>/dev/null || true
      else
        mv "$cg_legacy" "$cg_home" 2>/dev/null && ln -s ${CATGIRL_HOME_DIR} "$cg_legacy" 2>/dev/null || true
      fi
      rm -f "$cg_lock"
      break
    fi
    cg_owner="$(cat "$cg_lock" 2>/dev/null || true)"
    if [ -z "$cg_owner" ]; then cg_unowned=$((cg_unowned + 1)); else cg_unowned=0; fi
    if { [ -n "$cg_owner" ] && ! kill -0 "$cg_owner" 2>/dev/null; } || [ "$cg_unowned" -ge ${HOME_MOVE_UNOWNED_LOOKS} ]; then
      rm -f "$cg_lock"
      continue
    fi
    [ "$cg_waited" -lt ${HOME_MOVE_LOCK_WAIT_SECONDS} ] || break
    sleep 1
    cg_waited=$((cg_waited + 1))
  done
  if catgirl_home_unmoved; then printf '%s\\n' "$cg_legacy"; else printf '%s\\n' "$cg_home"; fi
}`;
