<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Release version ordering for the updater.
 *
 * Semver 2.0 precedence, the same as semver_cmp in tools/setup-docker-install.sh
 * and compareVersions in tools/publish-release-channel.mjs:
 * 1.0.0-beta.1 < 1.0.0-edge.5 < 1.0.0-rc.1 < 1.0.0. PHP's version_compare()
 * does not know "edge" and sorts it below beta, so it is not used here.
 */
final class ReleaseVersion
{
    /** Returns <0, 0 or >0. A leading "v" and build metadata are ignored. */
    public static function compare(string $a, string $b): int
    {
        [$coreA, $preA] = self::parse($a);
        [$coreB, $preB] = self::parse($b);
        for ($i = 0; $i < 3; $i++) {
            if ($coreA[$i] !== $coreB[$i]) {
                return $coreA[$i] <=> $coreB[$i];
            }
        }
        if ($preA === [] || $preB === []) {
            return count($preB) <=> count($preA);
        }
        $n = max(count($preA), count($preB));
        for ($i = 0; $i < $n; $i++) {
            if (! isset($preA[$i])) {
                return -1;
            }
            if (! isset($preB[$i])) {
                return 1;
            }
            $x = $preA[$i];
            $y = $preB[$i];
            $xNum = ctype_digit($x);
            $yNum = ctype_digit($y);
            if ($xNum && $yNum) {
                if ((int) $x !== (int) $y) {
                    return (int) $x <=> (int) $y;
                }
            } elseif ($xNum !== $yNum) {
                return $xNum ? -1 : 1;
            } elseif ($x !== $y) {
                return strcmp($x, $y) < 0 ? -1 : 1;
            }
        }

        return 0;
    }

    /**
     * Whether $candidate may replace $installed.
     *
     * An edge build and a beta or rc of the same X.Y.Z do not tell which is
     * newer: edge builds of X.Y.Z run both before and after those tags. So an
     * edge install takes only a newer edge build, a higher X.Y.Z, or the
     * final X.Y.Z. Schema migrations only go forward, so when in doubt, stay.
     */
    public static function isUpgrade(string $candidate, string $installed): bool
    {
        if (! self::isValid($candidate) || ! self::isValid($installed)) {
            return false;
        }
        if (self::compare($candidate, $installed) <= 0) {
            return false;
        }
        [$coreC, $preC] = self::parse($candidate);
        [$coreI, $preI] = self::parse($installed);

        return ! ($coreC === $coreI && self::isEdge($preI) && $preC !== [] && ! self::isEdge($preC));
    }

    public static function isValid(string $version): bool
    {
        return preg_match('/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/', trim($version)) === 1;
    }

    /** @param list<string> $pre */
    private static function isEdge(array $pre): bool
    {
        return ($pre[0] ?? '') === 'edge';
    }

    /** @return array{0: list<int>, 1: list<string>} */
    private static function parse(string $version): array
    {
        $trimmed = explode('+', ltrim(trim($version), 'v'), 2)[0];
        $dash = strpos($trimmed, '-');
        $core = $dash === false ? $trimmed : substr($trimmed, 0, $dash);
        $parts = array_map('intval', explode('.', $core));
        $pre = $dash === false ? [] : explode('.', substr($trimmed, $dash + 1));

        return [array_pad(array_slice($parts, 0, 3), 3, 0), $pre];
    }
}
