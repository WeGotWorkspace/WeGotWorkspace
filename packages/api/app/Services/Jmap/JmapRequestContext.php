<?php

declare(strict_types=1);

namespace App\Services\Jmap;

/**
 * Per-request JMAP context: the `using` list of the batch being dispatched.
 * Methods read it for per-request gates (the FileNode version-check
 * capability) — capabilities only take effect when listed in `using`.
 */
final class JmapRequestContext
{
    /** @var list<string> */
    private array $using = [];

    /**
     * @param  list<string>  $using
     */
    public function setUsing(array $using): void
    {
        $this->using = array_values(array_filter($using, 'is_string'));
    }

    public function uses(string $capability): bool
    {
        return in_array($capability, $this->using, true);
    }
}
