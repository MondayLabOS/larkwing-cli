#!/usr/bin/env python3
"""Inspect common Feishu document formatting issues via lark-cli."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys


def fetch_xml(doc: str) -> str:
    return subprocess.check_output(
        [
            "lark-cli",
            "docs",
            "+fetch",
            "--api-version",
            "v2",
            "--as",
            "user",
            "--doc",
            doc,
            "--detail",
            "with-ids",
            "--format",
            "json",
            "-q",
            ".data.document.content",
        ],
        text=True,
    )


def plain(xml_fragment: str) -> str:
    return re.sub(r"<[^>]+>", "", xml_fragment)


def inspect(xml: str) -> list[str]:
    issues: list[str] = []

    for match in re.finditer(
        r"<(?P<tag>title|h[1-9])\b(?P<attrs>[^>]*)>(?P<body>.*?)</(?P=tag)>",
        xml,
        re.S,
    ):
        body = match.group("body")
        if "<code>" in body or "</code>" in body:
            label = plain(body).strip()[:120]
            issues.append(f"heading contains inline code: <{match.group('tag')}> {label}")

    if re.search(r"<span\b[^>]*background-color=|background-color=|light-yellow|rgba\(255,246,122,0\.8\)", xml):
        issues.append("document contains color/highlight styling")

    pre_blocks = re.findall(r"<pre\b[^>]*><code>(.*?)</code></pre>", xml, re.S)
    nested = [block for block in pre_blocks if "<code>" in block or "</code>" in block]
    if nested:
        issues.append(f"code blocks contain nested inline code: {len(nested)}")

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("doc", help="Feishu/Lark doc URL or token")
    args = parser.parse_args()

    xml = fetch_xml(args.doc)
    issues = inspect(xml)
    if issues:
        print("formatting issues found:")
        for issue in issues:
            print(f"- {issue}")
        return 1

    pre_block_count = len(re.findall(r"<pre\b[^>]*><code>.*?</code></pre>", xml, re.S))
    print("formatting check passed")
    print(f"body_inline_code={ '<code>' in xml }")
    print(f"pre_blocks={pre_block_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
