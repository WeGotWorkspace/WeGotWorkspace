<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

/**
 * BlobAssembly/set (WGW extension, #1500): `create` an assembly
 * (`{size, type?}`) or `destroy` one (abandon). There is no `update`:
 * appending and finishing are BlobAssembly/append and BlobAssembly/finish.
 */
final class BlobAssemblySetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(private readonly BlobAssemblyService $assemblies) {}

    public function name(): string
    {
        return 'BlobAssembly/set';
    }

    public function capability(): string
    {
        return JmapCapabilities::BLOB_ASSEMBLY;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        if (($args['ifInState'] ?? null) !== null) {
            throw new JmapMethodException('invalidArguments', 'BlobAssembly/set has no state; omit ifInState.');
        }
        [$create, $update, $destroy] = $this->setOperations($args);

        $created = [];
        $notCreated = [];
        foreach ($create as $creationId => $payload) {
            $creationId = (string) $creationId;
            if (! is_array($payload) || array_diff(array_keys($payload), ['size', 'type']) !== []) {
                $notCreated[$creationId] = ['type' => 'invalidProperties', 'description' => 'An assembly takes only size and type.', 'properties' => is_array($payload) ? array_values(array_map(strval(...), array_diff(array_keys($payload), ['size', 'type']))) : []];

                continue;
            }
            $result = $this->assemblies->create($username, $payload['size'] ?? null, $payload['type'] ?? null);
            if (isset($result['type']) && ! isset($result['id'])) {
                $notCreated[$creationId] = $result;

                continue;
            }
            $created[$creationId] = $result;
        }

        $notUpdated = [];
        foreach (array_keys($update) as $id) {
            $notUpdated[(string) $id] = ['type' => 'forbidden', 'description' => 'Assemblies are changed with BlobAssembly/append and BlobAssembly/finish.'];
        }

        $destroyed = [];
        $notDestroyed = [];
        foreach ($destroy as $id) {
            try {
                if (is_string($id) && $this->assemblies->destroy($username, $id)) {
                    $destroyed[] = $id;

                    continue;
                }
            } catch (JmapMethodException $e) {
                // A call is appending to it right now: retry later.
                $notDestroyed[(string) $id] = ['type' => 'serverFail', 'description' => $e->getMessage()];

                continue;
            }
            $notDestroyed[is_string($id) ? $id : ''] = ['type' => 'notFound'];
        }

        return [
            'accountId' => $username,
            'oldState' => null,
            'newState' => 'none',
            'created' => $created === [] ? null : $created,
            'updated' => null,
            'destroyed' => $destroyed === [] ? null : $destroyed,
            'notCreated' => $notCreated === [] ? null : $notCreated,
            'notUpdated' => $notUpdated === [] ? null : $notUpdated,
            'notDestroyed' => $notDestroyed === [] ? null : $notDestroyed,
        ];
    }
}
