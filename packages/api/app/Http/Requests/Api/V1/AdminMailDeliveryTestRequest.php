<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class AdminMailDeliveryTestRequest extends FormRequest
{
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
            'to' => ['nullable', 'string', 'email'],
        ];
    }

    public function recipient(): string
    {
        $to = trim((string) $this->input('to', ''));

        return $to;
    }
}
