# Development environment

The canonical source-independent Ubuntu 26.04/Node 24 image installs the retained provider CLIs from unversioned npm specs and owner-pinned native Qwen Code 0.23.3. The image build explicitly allows Qwen's `@qwen-code/audio-capture` install script and fails unless `qwen --version` reports exactly 0.23.3.

Threadwire remains runtime-only. Native Qwen launches receive an exact task/session-owned `QWEN_HOME` from their parent; gateway credentials are passed transiently and are never baked into the image or source.
