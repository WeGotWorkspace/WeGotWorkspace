<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class PushSubscriptionRequest extends FormRequest
{
    use NarrowsValidatedInput;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'endpoint' => ['required', 'string', 'url', 'max:2048'],
            'keys' => ['required', 'array'],
            'keys.p256dh' => ['required', 'string', 'min:1', 'max:255'],
            'keys.auth' => ['required', 'string', 'min:1', 'max:255'],
        ];
    }

    /**
     * @return array{endpoint: string, keys: array{p256dh: string, auth: string}}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $keys = $validated['keys'] ?? null;
        $p256dh = is_array($keys) ? ($keys['p256dh'] ?? null) : null;
        $auth = is_array($keys) ? ($keys['auth'] ?? null) : null;

        return [
            'endpoint' => $this->requiredString($validated['endpoint'] ?? null),
            'keys' => [
                'p256dh' => $this->requiredString($p256dh),
                'auth' => $this->requiredString($auth),
            ],
        ];
    }
}
