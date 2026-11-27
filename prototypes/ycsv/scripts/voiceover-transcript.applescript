-- Spike 8: record what VoiceOver (macOS) says while moving through the Sheets grid.
--
-- Prerequisites (one time, by a person):
--   1. VoiceOver Utility → General → "Allow VoiceOver to be controlled with AppleScript" (on).
--   2. System Settings → Privacy & Security → Accessibility: allow the app that runs osascript
--      (Terminal, or the Claude app).
--   3. The Mac is unlocked and the browser window is frontmost-capable.
--   4. Storybook runs: cd prototypes/ycsv && pnpm storybook   (port 6007)
--
-- Run:
--   osascript scripts/voiceover-transcript.applescript Safari cell  > docs/spike-8-a11y/voiceover-safari-cell.txt
--   osascript scripts/voiceover-transcript.applescript Safari descendant > docs/spike-8-a11y/voiceover-safari-descendant.txt
--   osascript scripts/voiceover-transcript.applescript "Google Chrome" cell > docs/spike-8-a11y/voiceover-chrome-cell.txt
--
-- It opens the grid story (which focuses the sheet), starts VoiceOver, presses each
-- key, waits for speech, and prints "key ⟶ last phrase". VoiceOver is turned off at the end.

on run argv
	set browserName to item 1 of argv
	set model to item 2 of argv
	set storyUrl to "http://localhost:6007/iframe.html?id=spike-6-cell-ux--grid&viewMode=story&args=focusModel:" & model & ";autoFocus:!true"

	-- key name, key code, modifiers ("" / "shift" / "command" / "option shift")
	set steps to {¬
		{"Right", 124, ""}, ¬
		{"Right", 124, ""}, ¬
		{"Right (formula cell)", 124, ""}, ¬
		{"Down", 125, ""}, ¬
		{"Cmd+Down (data edge)", 125, "command"}, ¬
		{"Left (blank)", 123, ""}, ¬
		{"Left (#REF!)", 123, ""}, ¬
		{"Shift+Left (range)", 123, "shift"}, ¬
		{"Shift+Up (range)", 126, "shift"}, ¬
		{"Right (collapse)", 124, ""}, ¬
		{"Enter (edit)", 36, ""}, ¬
		{"Escape (cancel)", 53, ""}, ¬
		{"Shift+F10 (menu)", 109, "shift"}, ¬
		{"Down (menu item)", 125, ""}, ¬
		{"Escape (close menu)", 53, ""}}

	tell application browserName
		activate
		open location storyUrl
	end tell
	delay 4

	do shell script "open -a VoiceOver"
	delay 4

	set out to "VoiceOver transcript — " & browserName & ", focus model " & model & linefeed & linefeed
	-- The story focuses the sheet on load (autoFocus). Read what VoiceOver said about it first.
	try
		tell application "VoiceOver" to set phrase to content of last phrase
	on error errMsg
		set phrase to "(could not read: " & errMsg & ")"
	end try
	set out to out & "(load, focus in the sheet) ⟶ " & phrase & linefeed
	repeat with s in steps
		set label to item 1 of s
		set kc to item 2 of s
		set mods to item 3 of s
		tell application "System Events"
			if mods is "" then
				key code kc
			else if mods is "shift" then
				key code kc using shift down
			else if mods is "command" then
				key code kc using command down
			else if mods is "option shift" then
				key code kc using {option down, shift down}
			end if
		end tell
		delay 2.2
		try
			tell application "VoiceOver" to set phrase to content of last phrase
		on error errMsg
			set phrase to "(could not read: " & errMsg & ")"
		end try
		set out to out & label & " ⟶ " & phrase & linefeed
	end repeat

	tell application "VoiceOver" to quit
	return out
end run
