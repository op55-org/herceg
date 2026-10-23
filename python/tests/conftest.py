"""Contract tests: ``@pytest.mark.contract("line.z-index.refused.python")``
marks a test proving a contract, by an ID other tooling finds in the run's
JUnit XML (a ``contract`` property). IDs are the engine's (see the
architecture's "Contract tests"): lowercase words joined by dots."""

from __future__ import annotations

import re

import pytest

CONTRACT_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "contract(id): the test proves the contract id")


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    owners: dict[str, str] = {}
    for item in items:
        for marker in item.iter_markers("contract"):
            (contract,) = marker.args
            if not isinstance(contract, str) or not CONTRACT_ID.match(contract):
                raise pytest.UsageError(
                    f"{item.nodeid}: {contract!r} is not a contract ID; write words.joined.by-dots"
                )
            # A parametrized test proves one contract per case only with an ID per case.
            owner = owners.setdefault(contract, item.nodeid)
            if owner != item.nodeid:
                raise pytest.UsageError(
                    f"{item.nodeid}: contract {contract!r} is proved by {owner}"
                )
            item.user_properties.append(("contract", contract))
