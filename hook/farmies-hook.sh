#!/bin/sh
# Farmies hook: records the state of a Claude Code session for the desktop buddy.
# Called by Claude Code hooks as `hook.sh <EventName>` with the hook JSON on stdin.
# Writes one small JSON file per session into $BUDDY_DIR (latest event wins).

event="$1"
conf="$HOME/.farmies/config"
[ -f "$conf" ] && . "$conf"
BUDDY_DIR="${BUDDY_DIR:-$HOME/.farmies/sessions}"
ATTN_DIR="$HOME/.farmies/attn"

input=$(cat)

# Extracts a JSON string value (still JSON-escaped, which is what we write back): the first one
# with this name, from the hook input or from the text given as $2.
field() {
  printf '%s' "${2-$input}" \
    | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" \
    | head -n 1 \
    | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

# Escapes a plain string for embedding in JSON.
esc() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# A JSON-escaped value shortened for the hover panel to 300 bytes (the app shortens it further and
# makes it one line), never ending in a cut escape sequence.
clip() {
  printf '%s' "$1" \
    | head -c 300 \
    | sed -E 's/(^|[^\\])((\\\\)*)\\u[0-9a-fA-F]{0,3}$/\1\2/; s/(^|[^\\])((\\\\)*)\\$/\1\2/'
}

# What a tool call does, for the panel: "Edit · src/app.js", "Bash · npm test"
tool_step() {
  tool=$(field tool_name)
  target=$(field file_path)
  [ -n "$target" ] || target=$(field command)
  [ -n "$target" ] || target=$(field pattern)
  [ -n "$target" ] || target=$(field url)
  [ -n "$target" ] || target=$(field query)
  [ -n "$target" ] || target=$(field description)
  target=${target#"$cwd"/}
  if [ -n "$target" ]; then clip "$tool · $target"; else clip "$tool"; fi
}

sid=$(field session_id | tr -cd 'A-Za-z0-9_-')
[ -n "$sid" ] || exit 0
cwd=$(field cwd)
# Context for the hover panel, kept from the previous state file: task (the last prompt), the
# session's title, the last tool step. detail: what the current event is about (permission,
# question, result, error).
prev=$(cat "$BUDDY_DIR/$sid.json" 2>/dev/null)
task=$(field task "$prev")
title=$(field title "$prev")
step=$(field step "$prev")
detail=""
branch=""
message=""
ntype=""
term=""
tty=""
folder=""
app=""
pids=""

# Where the session runs, so the buddy can bring exactly that window/tab to the front:
#   term: cursor | vscode | vscode-insiders | windsurf | jetbrains | wt | apple-terminal | iterm | unknown
#   app:  macOS bundle id of the host application (macOS passes it to every process)
#   tty:  terminal device of the Claude process · pids: its ancestors (editor terminals are
#         matched by their shell pid, see extension/extension.js)
detect_context() {
  app="${__CFBundleIdentifier:-}"
  case "$PATH" in
    # WSL remote: the integrated terminal has the editor's server CLI on the PATH
    *"/.cursor-server/"*) term=cursor ;;
    *"/.windsurf-server/"*) term=windsurf ;;
    *"/.vscode-server-insiders/"*) term=vscode-insiders ;;
    *"/.vscode-server/"*) term=vscode ;;
    *)
      if [ "$TERM_PROGRAM" = vscode ]; then
        case "$app" in
          com.todesktop.230313mzl4w4u92) term=cursor ;;
          com.exafunction.windsurf) term=windsurf ;;
          com.microsoft.VSCodeInsiders) term=vscode-insiders ;;
          *) term=vscode ;;
        esac
      elif [ "$TERMINAL_EMULATOR" = JetBrains-JediTerm ]; then
        term=jetbrains
      elif [ -n "$WT_SESSION" ]; then
        term=wt
      elif [ "$TERM_PROGRAM" = Apple_Terminal ]; then
        term=apple-terminal
      elif [ "$TERM_PROGRAM" = iTerm.app ]; then
        term=iterm
      else
        term=unknown
      fi
      ;;
  esac

  # Walk up the parents: collect their pids and the first controlling terminal.
  pid=$PPID
  for _ in 1 2 3 4 5 6 7 8; do
    case "$pid" in "" | 0 | 1) break ;; esac
    pids="$pids $pid"
    if [ -z "$tty" ]; then
      t=$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')
      case "$t" in "" | "?" | "??") ;; *) tty="$t" ;; esac
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
  pids="${pids# }"

  folder=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
  branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
}

# Tab titles are used to find the tab of a session in WSL terminals (Windows Terminal etc., not in
# editors). WT_SESSION is not always passed into WSL, so it is not required.
can_title() {
  case "$term" in cursor | vscode | vscode-insiders | windsurf | jetbrains) return 1 ;; esac
  [ -n "$tty" ] && [ -w "/dev/$tty" ] && grep -qi microsoft /proc/version 2>/dev/null
}

set_title() {
  can_title || return 0
  printf '\033]0;%s\007' "$1" >"/dev/$tty" 2>/dev/null
}

write_state() {
  mkdir -p "$BUDDY_DIR" || return 0
  tmp="$BUDDY_DIR/.$sid.tmp"
  # transcript: the app treats a question/permission as handled when the transcript changes later
  # (cancelling a question in Claude fires no hook)
  # step stays the last field before ts: the PostToolUse heartbeat replaces just these two
  printf '{"session_id":"%s","event":"%s","cwd":"%s","folder":"%s","message":"%s","type":"%s","term":"%s","app":"%s","tty":"%s","pids":"%s","distro":"%s","transcript":"%s","branch":"%s","task":"%s","title":"%s","detail":"%s","step":"%s","ts":%s}\n' \
    "$sid" "$event" "$cwd" "$(esc "$folder")" "$message" "$ntype" "$term" "$(esc "$app")" "$(esc "$tty")" \
    "$pids" "$(esc "${WSL_DISTRO_NAME:-}")" "$(field transcript_path)" "$(esc "$branch")" "$task" "$title" "$detail" \
    "$step" "$(date +%s)" >"$tmp" && mv -f "$tmp" "$BUDDY_DIR/$sid.json"
}

# PreToolUse is only registered for AskUserQuestion: Claude asks the user a question.
[ "$event" = PreToolUse ] && event=Question
# a failed or denied tool call also means the session went on
[ "$event" = PostToolUseFailure ] && event=PostToolUse

case "$event" in
  Notification | PermissionRequest | Stop | Question | StopFailure)
    # A question may also trigger a notification or permission request; keep it a question.
    case "$event" in Notification | PermissionRequest)
      [ "$(sed -n 4p "$ATTN_DIR/$sid" 2>/dev/null)" = Question ] && exit 0 ;;
    esac
    ntype=$(field notification_type)
    # Only notifications that wait for the user count. Others leave the state as it is, above all
    # idle_prompt ("waiting for your input"), which follows every Stop after a minute.
    if [ "$event" = Notification ]; then
      case "$ntype" in
        permission_prompt | elicitation_dialog | elicitation_url_dialog | agent_needs_input) ;;
        "") case "$(field message)" in *"waiting for your input"*) exit 0 ;; esac ;; # older Claude Code
        *) exit 0 ;;
      esac
    fi
    case "$event" in
      PermissionRequest) detail=$(tool_step) ;;
      Question) detail=$(clip "$(field question)") ;;
      Stop) detail=$(clip "$(field last_assistant_message)") ;;
      StopFailure)
        detail=$(field error)
        [ -n "$detail" ] || detail=$(field message)
        detail=$(clip "$detail")
        ;;
      Notification)
        # a permission request usually comes first and says more than the notification
        detail=$(field detail "$prev")
        case "$prev" in *'"event":"PermissionRequest"'*) ;; *) detail=$(clip "$(field message)") ;; esac
        ;;
    esac
    detect_context
    write_state
    project=$(basename "$folder")
    mkdir -p "$ATTN_DIR"
    printf '%s\n%s\n%s\n%s\n' "$term" "$tty" "$project" "$event" >"$ATTN_DIR/$sid"
    # Briefly mark the tab title so the buddy app (Windows) learns which tab this session runs in;
    # the app then hands back the previous title in "<sid>.restore" (see src/wt-tabs.js).
    # Unique per session: several tabs may work on the same project.
    if can_title; then
      mark="(!) $project #$(printf '%.4s' "$sid")"
      rm -f "$BUDDY_DIR/$sid.restore" "$BUDDY_DIR/$sid.restored"
      set_title "$mark"
      # In the background (max. ~20 s): write back the title the app hands over. Claude Code sets
      # its own title right after some hooks (e.g. when a turn ends), so the marker is put back now
      # and then until the app has seen it.
      (
        i=0
        while [ "$i" -lt 40 ]; do
          sleep 0.5
          [ -f "$ATTN_DIR/$sid" ] || exit 0
          if [ -f "$BUDDY_DIR/$sid.restore" ]; then
            set_title "$(cat "$BUDDY_DIR/$sid.restore")"
            mv -f "$BUDDY_DIR/$sid.restore" "$BUDDY_DIR/$sid.restored"
            exit 0
          fi
          case $i in 2 | 4 | 8 | 14) set_title "$mark" ;; esac
          i=$((i + 1))
        done
      ) </dev/null >/dev/null 2>&1 &
    fi
    ;;
  UserPromptSubmit | PostToolUse)
    if [ -f "$ATTN_DIR/$sid" ]; then
      {
        read -r term
        read -r tty
        read -r project
      } <"$ATTN_DIR/$sid"
      rm -f "$ATTN_DIR/$sid"
      # nobody handed back the old title (buddy app not running): at least remove the marker
      if [ -f "$BUDDY_DIR/$sid.restored" ]; then
        rm -f "$BUDDY_DIR/$sid.restored"
      else
        set_title "$project"
      fi
    elif [ "$event" = PostToolUse ]; then
      # PostToolUse fires for every tool call: a "still working" heartbeat once a minute is enough.
      # Compared with the ts the hook wrote (same clock): under WSL the file time comes from Windows,
      # whose clock may differ from the WSL clock.
      # In between only the step is updated, in the file as it is (no context detection).
      last=$(printf '%s' "$prev" | sed -n 's/.*"event":"PostToolUse".*"ts":\([0-9]*\).*/\1/p')
      if [ -n "$last" ] && [ $(($(date +%s) - last)) -lt 60 ]; then
        head=${prev%%,\"step\":\"*}
        [ "$head" = "$prev" ] && exit 0 # older state file without a step
        tmp="$BUDDY_DIR/.$sid.tmp"
        printf '%s,"step":"%s","ts":%s}\n' "$head" "$(tool_step)" "$last" >"$tmp" && mv -f "$tmp" "$BUDDY_DIR/$sid.json"
        exit 0
      fi
    fi
    if [ "$event" = UserPromptSubmit ]; then
      task=$(clip "$(field prompt)")
      st=$(field session_title)
      [ -n "$st" ] && title=$(clip "$st")
      step=""
    else
      step=$(tool_step)
    fi
    tty="" # detect afresh (it may have been read from the marker file above)
    detect_context
    write_state
    ;;
  SessionStart)
    st=$(field session_title)
    [ -n "$st" ] && title=$(clip "$st")
    detect_context
    write_state
    ;;
  SessionEnd)
    rm -f "$BUDDY_DIR/$sid.json" "$BUDDY_DIR/$sid.tab" "$BUDDY_DIR/$sid.restore" "$BUDDY_DIR/$sid.restored" "$ATTN_DIR/$sid"
    ;;
esac
exit 0
