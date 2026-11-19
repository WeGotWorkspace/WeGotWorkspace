<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Exceptions\ApiHttpException;

/**
 * Subject types by name (#2173). Filled in a service provider; tests may add
 * their own. An unknown type answers 404, like a subject the caller cannot see.
 */
final class ThreadSubjectRegistry
{
    /** @var array<string, ThreadSubjectType> */
    private array $types = [];

    public function register(ThreadSubjectType $type): void
    {
        $name = $type->type();
        if (preg_match('/^[a-z][a-z0-9]{0,30}$/', $name) !== 1) {
            throw new \InvalidArgumentException('A thread subject type is a short lowercase name.');
        }
        $this->types[$name] = $type;
    }

    public function find(string $name): ?ThreadSubjectType
    {
        return $this->types[$name] ?? null;
    }

    public function require(string $name): ThreadSubjectType
    {
        return $this->find($name) ?? throw new ApiHttpException(404, 'Thread not found.', 'not_found');
    }

    /** @return list<ThreadSubjectType> */
    public function all(): array
    {
        return array_values($this->types);
    }
}
