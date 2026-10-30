# Licensing

Open Team is a fork of OpenMausBot. The retained core and the independently
written module in [`extensions/open-team/`](extensions/open-team/) are licensed
under the [Apache License 2.0](LICENSE). Preserve the original copyright and
attribution notices in [NOTICE](NOTICE) when distributing the project.

The original source-available Enterprise directory is excluded from this fork.
Its implementation and license issuer are not part of the Open Team module.
The Apache-licensed compatibility hook in `server/enterprise.ts` can still load
an externally supplied adapter when `OMB_ENTERPRISE_DIR` is explicitly set;
that adapter remains subject to its own terms.

## Contributions

Submit code you wrote or have permission to contribute under Apache 2.0.
No separate Enterprise CLA is required for this fork.

## Dependencies and trademarks

Third-party components retain their own licenses. Their notices, source
locations and license texts are listed in [NOTICE](NOTICE) and
[`third_party/`](third_party/).

The Apache license does not grant rights to upstream trademarks. The
OpenMausBot and MausBot names and mascot belong to their respective owner;
use your own product identity for redistribution.
