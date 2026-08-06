<?php

declare(strict_types=1);

namespace App\Services\Drive;

final class DriveShareAccess
{
    public const VIEW = 'view';

    public const COMMENT = 'comment';

    /** @deprecated Legacy suggest ACL — effective rights match {@see self::EDIT}. */
    public const REVIEW = 'review';

    public const EDIT = 'edit';

    public const FULL = 'full';

    /**
     * Rank for least-permissive merge. `review` shares edit's rank so it never
     * undercuts edit when both appear in grant resolution.
     *
     * @var array<string, int>
     */
    private const RANK = [
        self::VIEW => 1,
        self::COMMENT => 2,
        self::REVIEW => 4,
        self::EDIT => 4,
        self::FULL => 5,
    ];

    public static function isValid(string $access): bool
    {
        return array_key_exists($access, self::RANK);
    }

    /**
     * Normalize stored/accepted access. Legacy `review` becomes `edit`.
     */
    public static function normalize(string $access): string
    {
        $normalized = strtolower(trim($access));
        if ($normalized === self::REVIEW) {
            return self::EDIT;
        }

        return $normalized;
    }

    public static function leastPermissive(string $a, string $b): string
    {
        return self::rank($a) <= self::rank($b) ? $a : $b;
    }

    public static function rank(string $access): int
    {
        return self::RANK[$access] ?? 0;
    }

    /**
     * @return array{
     *   mayView: bool,
     *   mayComment: bool,
     *   mayReview: bool,
     *   mayEditContent: bool,
     *   mayManageStructure: bool,
     *   mayShare: bool
     * }
     */
    public static function rightsFor(
        string $access,
        bool $isCollabDoc,
        bool $mayShare = false,
        bool $isNotePath = false,
    ): array {
        // Legacy review grants get the same effective rights as edit (including mayEditContent)
        // so existing shares are not stranded as a half-broken suggest middle tier.
        $effective = self::normalize($access);
        $rank = self::rank($effective);
        $comment = $isCollabDoc && $rank >= self::rank(self::COMMENT);
        $edit = $rank >= self::rank(self::EDIT);
        $full = $rank >= self::rank(self::FULL);
        // Suggest/review mode in Docs is included with edit; keep mayReview for API compat.
        $review = $isCollabDoc && $edit;
        // Notes has no comment/review UX — force both false even if a bad grant row exists.
        // Notes personal shares are view|edit only — never structure-manage (legacy full → edit rights).
        if ($isNotePath) {
            $comment = false;
            $review = false;
            $full = false;
        }

        return [
            'mayView' => $rank >= self::rank(self::VIEW),
            'mayComment' => $comment,
            'mayReview' => $review,
            'mayEditContent' => $edit,
            'mayManageStructure' => $full,
            'mayShare' => $mayShare,
        ];
    }
}
