package main

import (
	"os/exec"
	"syscall"
)

// revealInExplorer opens Explorer with path selected. Explorer needs the exact
// form `/select,"path"`, which Go's default argument quoting would break, so
// the command line is passed verbatim.
func revealInExplorer(path string) error {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
	// Explorer returns exit code 1 even on success, so only start errors matter.
	return cmd.Start()
}
