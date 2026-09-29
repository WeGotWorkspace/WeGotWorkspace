<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class DocsThreadReplyRequest extends FormRequest
{
    use NarrowsValidatedInput;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'id' => ['required', 'string', 'max:26'],
            'body' => ['required', 'string', 'min:1'],
        ];
    }

    /**
     * @return array{id: string, body: string}
     */
    public function payload(): array
    {
        $validated = $this->validated();

        return [
            'id' => $this->requiredString($validated['id'] ?? null),
            'body' => $this->requiredString($validated['body'] ?? null),
        ];
    }
}
