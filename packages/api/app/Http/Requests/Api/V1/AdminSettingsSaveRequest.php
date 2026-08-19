<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class AdminSettingsSaveRequest extends FormRequest
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
            'values' => ['nullable', 'array'],
            'clearSmtpPassword' => ['sometimes', 'boolean'],
        ];
    }

    public function shouldClearSmtpPassword(): bool
    {
        return $this->boolean('clearSmtpPassword');
    }

    /**
     * @return array<string, mixed>
     */
    public function valueMap(): array
    {
        $values = $this->input('values');

        return is_array($values) ? $values : [];
    }
}
